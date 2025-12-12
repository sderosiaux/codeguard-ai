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
			Timeout: 30 * time.Second,
		},
	}
}

// Issue represents a security issue
type Issue struct {
	ID          interface{} `json:"id"` // Can be string or int
	Title       string      `json:"title"`
	Description string      `json:"description"`
	Severity    string      `json:"severity"`
	FilePath    string      `json:"filePath"`
	LineStart   int         `json:"lineStart"`
	LineEnd     int         `json:"lineEnd"`
	Suggestion  string      `json:"suggestion"`
	Category    string      `json:"category"`
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

// ScanStartResponse is the response from starting a scan
type ScanStartResponse struct {
	ScanID     string `json:"scanId"`
	Status     string `json:"status"`
	FilesCount int    `json:"filesCount"`
	Message    string `json:"message"`
}

// ScanStatusResponse is the response from checking scan status
type ScanStatusResponse struct {
	ScanID       string    `json:"scanId"`
	Status       string    `json:"status"`
	FilesScanned int       `json:"filesScanned"`
	Issues       []Issue   `json:"issues,omitempty"`
	Grade        string    `json:"grade,omitempty"`
	Score        int       `json:"score,omitempty"`
	Error        string    `json:"error,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
	CompletedAt  time.Time `json:"completedAt,omitempty"`
}

// ScanResponse is the final scan result (for backward compatibility)
type ScanResponse struct {
	Issues       []Issue `json:"issues"`
	Grade        string  `json:"grade"`
	Score        int     `json:"score"`
	FilesScanned int     `json:"filesScanned"`
}

// StartScan initiates a scan and returns immediately with a scan ID
func (c *Client) StartScan(files []FileContent) (*ScanStartResponse, error) {
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

	if resp.StatusCode != http.StatusAccepted && resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error (%d): %s", resp.StatusCode, string(respBody))
	}

	var startResp ScanStartResponse
	if err := json.Unmarshal(respBody, &startResp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &startResp, nil
}

// GetScanStatus checks the status of a scan
func (c *Client) GetScanStatus(scanID string) (*ScanStatusResponse, error) {
	req, err := http.NewRequest("GET", c.baseURL+"/cli/scan/"+scanID, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

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

	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("scan not found")
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error (%d): %s", resp.StatusCode, string(respBody))
	}

	var statusResp ScanStatusResponse
	if err := json.Unmarshal(respBody, &statusResp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &statusResp, nil
}

// Scan sends files to the API and polls until complete
func (c *Client) Scan(files []FileContent, onStatus func(status string)) (*ScanResponse, error) {
	// Start the scan
	startResp, err := c.StartScan(files)
	if err != nil {
		return nil, err
	}

	scanID := startResp.ScanID
	if onStatus != nil {
		onStatus("pending")
	}

	// Poll for results
	pollInterval := 2 * time.Second
	maxWait := 5 * time.Minute
	startTime := time.Now()

	for {
		if time.Since(startTime) > maxWait {
			return nil, fmt.Errorf("scan timed out after %v", maxWait)
		}

		time.Sleep(pollInterval)

		status, err := c.GetScanStatus(scanID)
		if err != nil {
			return nil, err
		}

		if onStatus != nil {
			onStatus(status.Status)
		}

		switch status.Status {
		case "completed":
			return &ScanResponse{
				Issues:       status.Issues,
				Grade:        status.Grade,
				Score:        status.Score,
				FilesScanned: status.FilesScanned,
			}, nil
		case "error":
			return nil, fmt.Errorf("scan failed: %s", status.Error)
		case "pending", "analyzing":
			// Continue polling
		default:
			return nil, fmt.Errorf("unknown scan status: %s", status.Status)
		}
	}
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

// User represents a user
type User struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatarUrl"`
}

// Workspace represents a workspace
type Workspace struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Slug string `json:"slug"`
	Role string `json:"role"`
}

// MeResponse is the response from /cli/me
type MeResponse struct {
	User        *User  `json:"user"`
	WorkspaceID string `json:"workspaceId"`
}

// WorkspacesResponse is the response from /cli/workspaces
type WorkspacesResponse struct {
	Workspaces         []Workspace `json:"workspaces"`
	CurrentWorkspaceID string      `json:"currentWorkspaceId"`
}

// GetMe returns the authenticated user and workspace from API key
func (c *Client) GetMe() (*MeResponse, error) {
	req, err := http.NewRequest("GET", c.baseURL+"/cli/me", nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	if c.apiKey == "" {
		return nil, fmt.Errorf("API key required")
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode == http.StatusUnauthorized {
		return nil, fmt.Errorf("invalid API key")
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error (%d): %s", resp.StatusCode, string(respBody))
	}

	var meResp MeResponse
	if err := json.Unmarshal(respBody, &meResp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &meResp, nil
}

// GetWorkspaces returns the user's workspaces
func (c *Client) GetWorkspaces() (*WorkspacesResponse, error) {
	req, err := http.NewRequest("GET", c.baseURL+"/cli/workspaces", nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	if c.apiKey == "" {
		return nil, fmt.Errorf("API key required")
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode == http.StatusUnauthorized {
		return nil, fmt.Errorf("invalid API key")
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error (%d): %s", resp.StatusCode, string(respBody))
	}

	var workspacesResp WorkspacesResponse
	if err := json.Unmarshal(respBody, &workspacesResp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &workspacesResp, nil
}
