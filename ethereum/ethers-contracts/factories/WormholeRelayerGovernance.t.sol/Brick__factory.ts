/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */
import { Signer, utils, Contract, ContractFactory, Overrides } from "ethers";
import type { Provider, TransactionRequest } from "@ethersproject/providers";
import type { PromiseOrValue } from "../../common";
import type {
  Brick,
  BrickInterface,
} from "../../WormholeRelayerGovernance.t.sol/Brick";

const _abi = [
  {
    inputs: [],
    name: "checkAndExecuteUpgradeMigration",
    outputs: [],
    stateMutability: "view",
    type: "function",
  },
] as const;

const _bytecode =
  "0x6080604052348015600f57600080fd5b50606580601d6000396000f3fe6080604052348015600f57600080fd5b506004361060285760003560e01c80632c75470f14602d575b600080fd5b00fea26469706673582212200427629e2034af48c06a7fbb7600a077d88274e583e744d8739927d5679c27e764736f6c63430008130033";

type BrickConstructorParams =
  | [signer?: Signer]
  | ConstructorParameters<typeof ContractFactory>;

const isSuperArgs = (
  xs: BrickConstructorParams
): xs is ConstructorParameters<typeof ContractFactory> => xs.length > 1;

export class Brick__factory extends ContractFactory {
  constructor(...args: BrickConstructorParams) {
    if (isSuperArgs(args)) {
      super(...args);
    } else {
      super(_abi, _bytecode, args[0]);
    }
  }

  override deploy(
    overrides?: Overrides & { from?: PromiseOrValue<string> }
  ): Promise<Brick> {
    return super.deploy(overrides || {}) as Promise<Brick>;
  }
  override getDeployTransaction(
    overrides?: Overrides & { from?: PromiseOrValue<string> }
  ): TransactionRequest {
    return super.getDeployTransaction(overrides || {});
  }
  override attach(address: string): Brick {
    return super.attach(address) as Brick;
  }
  override connect(signer: Signer): Brick__factory {
    return super.connect(signer) as Brick__factory;
  }

  static readonly bytecode = _bytecode;
  static readonly abi = _abi;
  static createInterface(): BrickInterface {
    return new utils.Interface(_abi) as BrickInterface;
  }
  static connect(address: string, signerOrProvider: Signer | Provider): Brick {
    return new Contract(address, _abi, signerOrProvider) as Brick;
  }
}