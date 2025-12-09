package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Client is the CodeGuard API client
type Client struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
}

// NewClient creates a new API client
func NewClient(baseURL, apiKey string) *Client {
	return &Client{
		baseURL: baseURL,
		apiKey:  apiKey,
		httpClient: &http.Client{
			Timeout: 5 * time.Minute,
		},
	}
}

// Issue represents a security issue
type Issue struct {
	ID          int    `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Severity    string `json:"severity"`
	FilePath    string `json:"filePath"`
	LineStart   int    `json:"lineStart"`
	LineEnd     int    `json:"lineEnd"`
	Suggestion  string `json:"suggestion"`
	Category    string `json:"category"`
}

// ScanRequest is the request body for scanning
type ScanRequest struct {
	Files []FileContent `json:"files"`
}

// FileContent represents a file and its content
type FileContent struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

// ScanResponse is the response from a scan
type ScanResponse struct {
	Issues      []Issue `json:"issues"`
	Grade       string  `json:"grade"`
	Score       int     `json:"score"`
	FilesScanned int    `json:"filesScanned"`
}

// Scan sends files to the API for analysis
func (c *Client) Scan(files []FileContent) (*ScanResponse, error) {
	body, err := json.Marshal(ScanRequest{Files: files})
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequest("POST", c.baseURL+"/cli/scan", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error (%d): %s", resp.StatusCode, string(respBody))
	}

	var scanResp ScanResponse
	if err := json.Unmarshal(respBody, &scanResp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &scanResp, nil
}

// HealthCheck verifies the API is reachable
func (c *Client) HealthCheck() error {
	req, err := http.NewRequest("GET", c.baseURL+"/health", nil)
	if err != nil {
		return err
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("API unreachable: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("API returned status %d", resp.StatusCode)
	}

	return nil
}
