package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

const (
	configFileName = ".codeguard.json"
	DefaultAPIURL  = "https://security-guard-ai.vercel.app/api"
)

// Config holds the CLI configuration
type Config struct {
	APIURL   string `json:"api_url"`
	APIKey   string `json:"api_key"`
	TeamID   string `json:"team_id,omitempty"`
}

// configPath returns the path to the config file
func configPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, configFileName), nil
}

// Load loads the configuration from disk
func Load() (*Config, error) {
	path, err := configPath()
	if err != nil {
		return nil, err
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &Config{APIURL: DefaultAPIURL}, nil
		}
		return nil, err
	}

	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}

	if cfg.APIURL == "" {
		cfg.APIURL = DefaultAPIURL
	}

	return &cfg, nil
}

// Save saves the configuration to disk
func Save(cfg *Config) error {
	path, err := configPath()
	if err != nil {
		return err
	}

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, data, 0600)
}

// IsAuthenticated returns true if an API key is configured
func (c *Config) IsAuthenticated() bool {
	return c.APIKey != ""
}
