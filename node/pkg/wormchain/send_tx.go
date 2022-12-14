package wormchain

import (
	"context"
	"fmt"

	// bookkeeping "github.com/certusone/wormhole-chain/x/bookkeeping/types"

	"github.com/certusone/wormhole/node/pkg/supervisor"
	txclient "github.com/cosmos/cosmos-sdk/client/tx"
	sdktypes "github.com/cosmos/cosmos-sdk/types"
	sdktx "github.com/cosmos/cosmos-sdk/types/tx"
	"github.com/cosmos/cosmos-sdk/types/tx/signing"
	authsigning "github.com/cosmos/cosmos-sdk/x/auth/signing"
	auth "github.com/cosmos/cosmos-sdk/x/auth/types"
	"go.uber.org/zap"
)

func (c *ClientConn) SignAndBroadcastTx(ctx context.Context, msg sdktypes.Msg) error {
	// Lock to protect the wallet sequence number.
	c.mutex.Lock()
	defer c.mutex.Unlock()

	authClient := auth.NewQueryClient(c.c)
	accountQuery := &auth.QueryAccountRequest{
		Address: c.publicKey,
	}
	resp, err := authClient.Account(ctx, accountQuery)
	if err != nil {
		return fmt.Errorf("failed to fetch account: %w", err)
	}

	var account auth.AccountI
	if err := c.encCfg.InterfaceRegistry.UnpackAny(resp.Account, &account); err != nil {
		return fmt.Errorf("failed to unmarshal account info: %w", err)
	}

	builder := c.encCfg.TxConfig.NewTxBuilder()
	if err := builder.SetMsgs(msg); err != nil {
		return fmt.Errorf("failed to add message to builder: %w", err)
	}
	builder.SetGasLimit(200000) // TODO: Maybe simulate and use the result

	// The tx needs to be signed in 2 passes: first we populate the SignerInfo
	// inside the TxBuilder and then sign the payload.
	sequence := account.GetSequence()
	sig := signing.SignatureV2{
		PubKey: c.privateKey.PubKey(),
		Data: &signing.SingleSignatureData{
			SignMode:  c.encCfg.TxConfig.SignModeHandler().DefaultMode(),
			Signature: nil,
		},
		Sequence: sequence,
	}
	if err := builder.SetSignatures(sig); err != nil {
		return fmt.Errorf("failed to set SignerInfo: %w", err)
	}

	signerData := authsigning.SignerData{
		ChainID:       "wormholechain",
		AccountNumber: account.GetAccountNumber(),
		Sequence:      sequence,
	}

	sig, err = txclient.SignWithPrivKey(
		c.encCfg.TxConfig.SignModeHandler().DefaultMode(),
		signerData,
		builder,
		c.privateKey,
		c.encCfg.TxConfig,
		sequence,
	)
	if err != nil {
		return fmt.Errorf("failed to sign tx: %w", err)
	}
	if err := builder.SetSignatures(sig); err != nil {
		return fmt.Errorf("failed to update tx signature: %w", err)
	}

	txBytes, err := c.encCfg.TxConfig.TxEncoder()(builder.GetTx())
	if err != nil {
		return fmt.Errorf("failed to marshal tx: %w", err)
	}

	client := sdktx.NewServiceClient(c.c)

	// Returns *BroadcastTxResponse
	txResp, err := client.BroadcastTx(
		ctx,
		&sdktx.BroadcastTxRequest{
			Mode:    sdktx.BroadcastMode_BROADCAST_MODE_BLOCK,
			TxBytes: txBytes,
		},
	)
	if err != nil {
		return fmt.Errorf("failed to broadcast tx: %w", err)
	}

	logger := supervisor.Logger(ctx)
	out, err := c.encCfg.Marshaler.MarshalJSON(txResp)
	if err != nil {
		logger.Error("failed to marshal BroadcastTx response", zap.Any("response", txResp), zap.Error(err))
	} else {
		logger.Info("Broadcasted CommitTransfer message", zap.String("response", string(out)))
	}

	return nil
}