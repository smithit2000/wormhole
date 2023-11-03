package promremotew

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"

	"github.com/golang/snappy"
	"go.uber.org/zap"
	"google.golang.org/protobuf/proto"
)

type PromTelemetryInfo struct {
	PromRemoteURL string
	StatusPort    uint16
	NodeName      string
}

func scrapeLocalMetrics(ctx context.Context, metricsPort uint16) ([]byte, error) {
	// The idea is to grab all the metrics from localhost:6060/metrics,
	// and then send them to Grafana.
	metricsURL := fmt.Sprintf("http://localhost:%d/metrics", metricsPort)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, metricsURL, nil)
	if err != nil {
		// Could not create request
		return nil, err
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		// Error creating http request
		return nil, err
	}
	if res.StatusCode != 200 {
		// Non-200 status code
		return nil, fmt.Errorf("Non-200 status code: %d", res.StatusCode)
	}
	resBody, err := io.ReadAll(res.Body)
	if err != nil {
		// Could not read response body
		return nil, err
	}
	// fmt.Printf("client: response body: %s\n", resBody)
	return resBody, nil
}

func ScrapeAndSendLocalMetrics(ctx context.Context, info PromTelemetryInfo, logger *zap.Logger) error {
	metrics, err := scrapeLocalMetrics(ctx, info.StatusPort)
	if err != nil {
		logger.Error("Could not scrape local metrics", zap.Error(err))
		return err
	}
	input := bytes.NewReader(metrics)
	labels := map[string]string{"node_name": info.NodeName}

	writeRequest, err := MetricTextToWriteRequest(input, labels)
	if err != nil {
		logger.Error("Could not create write request", zap.Error(err))
		return err
	}
	raw, err := proto.Marshal(writeRequest)
	// raw, err := writeRequest.Marshal()
	if err != nil {
		logger.Error("Could not marshal write request", zap.Error(err))
		return err
	}
	oSnap := snappy.Encode(nil, raw)
	bodyReader := bytes.NewReader(oSnap)

	// Create the http request
	// requestURL := fmt.Sprintf("https://%s:%s@%s", info.PromRemoteUser, info.PromRemoteKey, info.PromRemoteURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, info.PromRemoteURL, bodyReader)
	if err != nil {
		logger.Error("Could not create request", zap.Error(err))
		return err
	}
	req.Header.Set("Content-Encoding", "snappy")
	req.Header.Set("Content-Type", "application/x-protobuf")
	req.Header.Set("User-Agent", "Guardian")
	req.Header.Set("X-Prometheus-Remote-Write-Version", "0.1.0")

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		logger.Error("Error creating http request", zap.Error(err))
		return err
	}

	logger.Debug("Grafana result", zap.Int("status code", res.StatusCode))
	if res.StatusCode != 200 {
		logger.Error("Grafana returned non-200 status code", zap.Int("status code", res.StatusCode))
		return err
	}
	return nil
}

// func StartPrometheusScraper(ctx context.Context, info PromTelemetryInfo, logger *zap.Logger) error {
// 	promLogger := logger.With(zap.String("component", "prometheus_scraper"))
// 	for {
// 		// Sleeping first to give things a chance to set up
// 		time.Sleep(15 * time.Second)
// 		ScrapeAndSendLocalMetrics(info, promLogger)
// 		select {
// 		case <-ctx.Done():
// 			return ctx.Err()
// 		}
// 	}
// }
