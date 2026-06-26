package logformat

const sampleSize = 10

// Detector samples the first lines of a log stream to select the best Format,
// then parses all subsequent lines with that format.
type Detector struct {
	format Format
	sample []string
}

// Parse returns a ParsedLine for line. The first sampleSize lines are used to
// detect the format; those lines are parsed with the Unstructured fallback.
// Once enough samples have been collected the format is locked in.
func (d *Detector) Parse(line string) ParsedLine {
	if d.format == nil {
		d.sample = append(d.sample, line)
		if len(d.sample) >= sampleSize {
			d.lockIn()
			return d.format.Parse(line)
		}
		return (unstructured{}).Parse(line)
	}
	return d.format.Parse(line)
}

// FormatName returns the name of the locked-in format, or "unstructured" if
// detection has not yet completed.
func (d *Detector) FormatName() string {
	if d.format == nil {
		return "unstructured"
	}
	return d.format.Name()
}

// IsLocked reports whether format detection has completed.
func (d *Detector) IsLocked() bool { return d.format != nil }

// Finalize forces format detection based on whatever samples have been
// collected so far. No-op if the format is already locked in. Call this when
// the stream ends before sampleSize lines have been seen.
func (d *Detector) Finalize() {
	if d.format != nil {
		return
	}
	if len(d.sample) == 0 {
		d.format = unstructured{}
		return
	}
	d.lockIn()
	if d.format == nil {
		d.format = unstructured{}
	}
}

func (d *Detector) lockIn() {
	counts := make(map[string]int, len(registered))
	for _, line := range d.sample {
		for _, f := range registered {
			if f.Detect(line) {
				counts[f.Name()]++
			}
		}
	}
	n := len(d.sample)
	var best Format
	bestCount := 0
	for _, f := range registered {
		if c := counts[f.Name()]; c > bestCount {
			bestCount = c
			best = f
		}
	}
	// Require a majority of sample lines to agree on a format.
	if best != nil && bestCount*2 >= n {
		d.format = best
	} else {
		d.format = unstructured{}
	}
}
