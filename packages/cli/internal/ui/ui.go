package ui

import (
	"fmt"
	"strings"
)

// ANSI color codes
const (
	Reset      = "\033[0m"
	Bold       = "\033[1m"
	Dim        = "\033[2m"

	Red        = "\033[31m"
	Green      = "\033[32m"
	Yellow     = "\033[33m"
	Blue       = "\033[34m"
	Magenta    = "\033[35m"
	Cyan       = "\033[36m"
	White      = "\033[37m"

	BrightRed    = "\033[91m"
	BrightGreen  = "\033[92m"
	BrightYellow = "\033[93m"
	BrightCyan   = "\033[96m"
)

// Severity colors
func SeverityColor(severity string) string {
	switch strings.ToLower(severity) {
	case "critical":
		return BrightRed
	case "high":
		return Red
	case "medium":
		return Yellow
	case "low":
		return Green
	default:
		return White
	}
}

// Logo returns the ASCII art logo
func Logo() string {
	return fmt.Sprintf(`%s
   ___          _       ___                     _
  / __\___   __| | ___ / _ \_   _  __ _ _ __ __| |
 / /  / _ \ / _' |/ _ \ /_\/ | | |/ _' | '__/ _' |
/ /__| (_) | (_| |  __/ /_\\| |_| | (_| | | | (_| |
\____/\___/ \__,_|\___\____/ \__,_|\__,_|_|  \__,_|
                                              %sAI%s
%s`, BrightGreen, BrightCyan, BrightGreen, Reset)
}

// VersionTemplate returns a formatted version string
func VersionTemplate(version string) string {
	return fmt.Sprintf("%sCodeGuard AI%s version %s%s%s\n", Bold, Reset, BrightGreen, version, Reset)
}

// Success prints a success message
func Success(msg string) {
	fmt.Printf("%s✓%s %s\n", BrightGreen, Reset, msg)
}

// Error prints an error message
func Error(msg string) {
	fmt.Printf("%s✗%s %s\n", BrightRed, Reset, msg)
}

// Warning prints a warning message
func Warning(msg string) {
	fmt.Printf("%s⚠%s %s\n", Yellow, Reset, msg)
}

// Info prints an info message
func Info(msg string) {
	fmt.Printf("%s→%s %s\n", Cyan, Reset, msg)
}

// SpinnerFrames contains characters for loading animation
var SpinnerFrames = []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}

// Spinner represents a loading spinner
type Spinner struct {
	message string
	frame   int
	done    chan bool
}

// NewSpinner creates a new spinner
func NewSpinner(message string) *Spinner {
	return &Spinner{
		message: message,
		frame:   0,
		done:    make(chan bool),
	}
}

// SeverityBadge returns a colored badge for severity
func SeverityBadge(severity string) string {
	color := SeverityColor(severity)
	return fmt.Sprintf("%s%s[%s]%s", color, Bold, strings.ToUpper(severity), Reset)
}

// GradeBadge returns a colored grade badge
func GradeBadge(grade string) string {
	var color string
	switch grade {
	case "A":
		color = BrightGreen
	case "B":
		color = Green
	case "C":
		color = Yellow
	case "D":
		color = Red
	case "F":
		color = BrightRed
	default:
		color = White
	}
	return fmt.Sprintf("%s%s%s%s", color, Bold, grade, Reset)
}

// Box draws a box around text
func Box(title, content string) string {
	lines := strings.Split(content, "\n")
	maxLen := len(title)
	for _, line := range lines {
		if len(stripAnsi(line)) > maxLen {
			maxLen = len(stripAnsi(line))
		}
	}

	width := maxLen + 4
	border := strings.Repeat("─", width-2)

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("%s┌%s┐%s\n", Dim, border, Reset))
	sb.WriteString(fmt.Sprintf("%s│%s %s%-*s %s│%s\n", Dim, Reset, Bold, maxLen, title, Dim, Reset))
	sb.WriteString(fmt.Sprintf("%s├%s┤%s\n", Dim, border, Reset))

	for _, line := range lines {
		padding := maxLen - len(stripAnsi(line))
		sb.WriteString(fmt.Sprintf("%s│%s %s%s %s│%s\n", Dim, Reset, line, strings.Repeat(" ", padding), Dim, Reset))
	}

	sb.WriteString(fmt.Sprintf("%s└%s┘%s\n", Dim, border, Reset))
	return sb.String()
}

// stripAnsi removes ANSI escape codes for length calculation
func stripAnsi(s string) string {
	result := s
	for {
		start := strings.Index(result, "\033[")
		if start == -1 {
			break
		}
		end := strings.Index(result[start:], "m")
		if end == -1 {
			break
		}
		result = result[:start] + result[start+end+1:]
	}
	return result
}

// ProgressBar returns a progress bar string
func ProgressBar(current, total int, width int) string {
	if total == 0 {
		return ""
	}

	percent := float64(current) / float64(total)
	filled := int(percent * float64(width))

	bar := strings.Repeat("█", filled) + strings.Repeat("░", width-filled)
	return fmt.Sprintf("%s%s%s %d/%d", BrightGreen, bar, Reset, current, total)
}
