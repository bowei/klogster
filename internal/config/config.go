package config

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

type Config []LogGroup

type LogGroup struct {
	Name      string     `yaml:"name"`
	Selectors []Selector `yaml:"selectors"`
}

type Selector struct {
	Namespace  string            `yaml:"namespace"`
	Labels     map[string]string `yaml:"labels"`
	Containers []string          `yaml:"containers"`
}

func Load(path string) (Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading config: %w", err)
	}
	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parsing config: %w", err)
	}
	seen := map[string]bool{}
	for _, g := range cfg {
		if g.Name == "" {
			return nil, fmt.Errorf("log group missing name")
		}
		if seen[g.Name] {
			return nil, fmt.Errorf("duplicate log group name: %s", g.Name)
		}
		seen[g.Name] = true
		if len(g.Selectors) == 0 {
			return nil, fmt.Errorf("log group %q has no selectors", g.Name)
		}
		for _, s := range g.Selectors {
			if s.Namespace == "" {
				return nil, fmt.Errorf("log group %q has selector with empty namespace", g.Name)
			}
		}
	}
	return cfg, nil
}
