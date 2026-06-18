package streamer

import (
	"context"
	"io"
	"os"
	"time"
)

const filePollInterval = 250 * time.Millisecond

type fileLogOpener struct {
	path string
}

func (o *fileLogOpener) open(ctx context.Context) (io.ReadCloser, error) {
	f, err := os.Open(o.path)
	if err != nil {
		return nil, err
	}
	return &tailReader{ctx: ctx, f: f}, nil
}

// tailReader wraps an *os.File and blocks on Read when at EOF, polling for new
// content every filePollInterval until the context is cancelled.
type tailReader struct {
	ctx context.Context
	f   *os.File
}

func (r *tailReader) Read(p []byte) (int, error) {
	for {
		n, err := r.f.Read(p)
		if n > 0 {
			return n, nil
		}
		if err != io.EOF {
			return 0, err
		}
		select {
		case <-r.ctx.Done():
			return 0, io.EOF
		case <-time.After(filePollInterval):
		}
	}
}

func (r *tailReader) Close() error {
	return r.f.Close()
}
