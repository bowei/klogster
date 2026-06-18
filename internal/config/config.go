package config

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

type Config []LogGroup

type LogGroup struct {
	Name string     `yaml:"name"`
	K8s  *K8sSource `yaml:"k8s,omitempty"`
	File *FileSource `yaml:"file,omitempty"`
}

type K8sSource struct {
	Selectors []Selector `yaml:"selectors"`
}

type FileSource struct {
	Path string `yaml:"path"`
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
		switch {
		case g.K8s != nil && g.File != nil:
			return nil, fmt.Errorf("log group %q: cannot specify both k8s and file sources", g.Name)
		case g.K8s != nil:
			if len(g.K8s.Selectors) == 0 {
				return nil, fmt.Errorf("log group %q has no k8s selectors", g.Name)
			}
			for _, s := range g.K8s.Selectors {
				if s.Namespace == "" {
					return nil, fmt.Errorf("log group %q has k8s selector with empty namespace", g.Name)
				}
			}
		case g.File != nil:
			if g.File.Path == "" {
				return nil, fmt.Errorf("log group %q has empty file path", g.Name)
			}
		default:
			return nil, fmt.Errorf("log group %q: must specify either k8s or file source", g.Name)
		}
	}
	return cfg, nil
}
