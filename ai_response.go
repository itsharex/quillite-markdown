package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

const maxAIResponseBytes = 8 << 20

var (
	errAIResponseTooLarge   = errors.New("AI_RESPONSE_TOO_LARGE: the response exceeds the safe size limit")
	errAIResponseIncomplete = errors.New("AI_RESPONSE_INCOMPLETE: the service did not return a complete answer")
	errAIProviderFailure    = errors.New("AI_PROVIDER_ERROR: the service reported an error while generating the answer")
)

func readAIResponse(reader io.Reader) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(reader, maxAIResponseBytes+1))
	if err != nil {
		return nil, fmt.Errorf("%w: %w", errAIResponseIncomplete, err)
	}
	if len(data) > maxAIResponseBytes {
		return nil, errAIResponseTooLarge
	}
	return data, nil
}

// Parse SSE frames, not individual data lines. Never return partially collected
// text on an error. A streamed delta needs DONE or a successful finish reason;
// a gateway's complete message frame remains compatible without a DONE frame.
func decodeAIEventStream(reader io.Reader, emit func(string)) (string, error) {
	limited := &io.LimitedReader{R: reader, N: maxAIResponseBytes + 1}
	scanner := bufio.NewScanner(limited)
	scanner.Buffer(make([]byte, 64*1024), maxAIResponseBytes+1)
	var combined strings.Builder
	var nonSSE strings.Builder
	sawData := false
	var frame []string
	eventType := ""
	completed, done, sawDelta, completeMessage := false, false, false, false
	process := func() error {
		if eventType == "error" {
			return errAIProviderFailure
		}
		eventType = ""
		if len(frame) == 0 {
			return nil
		}
		data := strings.TrimSpace(strings.Join(frame, "\n"))
		frame = nil
		if data == "[DONE]" {
			completed, done = true, true
			return nil
		}
		var event aiChatResponse
		if err := json.Unmarshal([]byte(data), &event); err != nil {
			return errAIResponseIncomplete
		}
		if event.hasError() {
			return errAIProviderFailure
		}
		if len(event.Choices) == 0 {
			return nil
		} // usage-only frame
		choice := event.Choices[0]
		part, err := choice.answerText()
		if err != nil {
			return err
		}
		if len(choice.Delta.Content) > 0 || len(choice.Delta.Text) > 0 {
			sawDelta = true
		}
		if strings.TrimSpace(part) != "" && (len(choice.Message.Content) > 0 || len(choice.Message.Text) > 0 || len(choice.Text) > 0) {
			completeMessage = true
		}
		if choice.FinishReason == "stop" || choice.FinishReason == "tool_calls" || choice.FinishReason == "function_call" {
			completed = true
		}
		combined.WriteString(part)
		if part != "" && emit != nil {
			emit(part)
		}
		return nil
	}
	for scanner.Scan() {
		if limited.N == 0 {
			return "", errAIResponseTooLarge
		}
		line := strings.TrimSuffix(scanner.Text(), "\r")
		if !sawData {
			nonSSE.WriteString(line)
			nonSSE.WriteByte('\n')
		}
		if line == "" {
			if err := process(); err != nil {
				return "", err
			}
			if done {
				break
			}
			continue
		}
		if strings.HasPrefix(line, "data:") {
			sawData = true
			nonSSE.Reset()
			frame = append(frame, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
		}
		if strings.HasPrefix(line, "event:") {
			eventType = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		}
	}
	if limited.N == 0 {
		return "", errAIResponseTooLarge
	}
	if err := scanner.Err(); err != nil {
		return "", fmt.Errorf("%w: %w", errAIResponseIncomplete, err)
	}
	// Some compatible gateways mislabel a complete JSON response as SSE. Only
	// accept an actual complete JSON document, never recover a partial delta.
	if !sawData {
		var response aiChatResponse
		if json.Unmarshal([]byte(nonSSE.String()), &response) == nil {
			return response.answerText()
		}
	}
	if !done {
		if err := process(); err != nil {
			return "", err
		}
	}
	if !completed && !(completeMessage && !sawDelta) {
		return "", errAIResponseIncomplete
	}
	if strings.TrimSpace(combined.String()) == "" {
		return "", errAIEmptyReply
	}
	return combined.String(), nil
}

func (result aiChatResponse) hasError() bool {
	return len(result.Error) > 0 && !bytes.Equal(bytes.TrimSpace(result.Error), []byte("null"))
}
