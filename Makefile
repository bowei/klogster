.PHONY: build test test-go test-js

build:
	go build -o klogster ./cmd

test: test-go test-js

test-go:
	go test ./...

test-js:
	node --test web/static/*.test.js
