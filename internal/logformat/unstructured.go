package logformat

// unstructured is the fallback format. It attempts to extract a level from the
// start of the message but otherwise treats the line as plain text.
// It is not registered in the global list; the Detector uses it directly.
type unstructured struct{}

func (unstructured) Name() string { return "unstructured" }

func (unstructured) Detect(line string) bool { return true }

func (unstructured) Parse(line string) ParsedLine {
	return ParsedLine{
		Raw:     line,
		Level:   extractLevelFromMessage(line),
		Message: line,
	}
}
