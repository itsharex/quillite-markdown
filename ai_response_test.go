package main

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAIResponseRejectsTruncationAndInStreamErrors(t *testing.T) {
	prefix := "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n"
	for _, test := range []struct {
		name, body string
		want       error
	}{
		{"missing end", prefix, errAIResponseIncomplete},
		{"provider error", prefix + "data: {\"error\":{\"message\":\"private request text\"}}\n\ndata: [DONE]\n", errAIProviderFailure},
		{"error event", prefix + "event: error\ndata: {\"message\":\"private request text\"}\n\ndata: [DONE]\n", errAIProviderFailure},
		{"malformed event", prefix + "data: {broken}\n\ndata: [DONE]\n", errAIResponseIncomplete},
		{"unknown finish", prefix + "data: {\"choices\":[{\"finish_reason\":\"error\"}]}\n\ndata: [DONE]\n", errAIResponseIncomplete},
		{"truncated last frame", prefix + "data: {\"choices\":[", errAIResponseIncomplete},
		{"limit", prefix + ":" + strings.Repeat(" ", maxAIResponseBytes) + "\n\ndata: [DONE]\n", errAIResponseTooLarge},
	} {
		t.Run(test.name, func(t *testing.T) {
			for _, streamed := range []bool{false, true} {
				var answer string
				var err error
				if streamed {
					answer, err = decodeAIEventStream(strings.NewReader(test.body), nil)
				} else {
					answer, err = decodeAIChatResponse(strings.NewReader(test.body))
				}
				if answer != "" || !errors.Is(err, test.want) {
					t.Fatalf("streamed=%t answer=%q err=%v", streamed, answer, err)
				}
				if strings.Contains(err.Error(), "private request text") {
					t.Fatal("provider error body exposed")
				}
			}
		})
	}
}

func TestAIResponseAcceptsCompleteSSEForms(t *testing.T) {
	for _, body := range []string{
		"data: {\"choices\":[{\"delta\":{\"content\":\"answer\"},\"finish_reason\":\"stop\"}]}\n\n",
		"data: {\"choices\":[\n" + "data: {\"delta\":{\"content\":\"answer\"}}]}\r\n\r\ndata: [DONE]\r\n\r\n",
		"data: {\"choices\":[{\"message\":{\"content\":\"answer\"}}]}\n\n",
		"data: {\"choices\":[{\"delta\":{\"content\":\"answer\"}}]}\n\ndata: [DONE]\n\n",
	} {
		answer, err := decodeAIChatResponse(strings.NewReader(body))
		if err != nil || answer != "answer" {
			t.Fatalf("answer=%q err=%v body=%q", answer, err, body)
		}
	}
}

func TestAIResponseLimitsJSONAndNonStreamingRequests(t *testing.T) {
	body := `{"choices":[{"message":{"content":"answer"}}]}` + strings.Repeat(" ", maxAIResponseBytes)
	if answer, err := decodeAIChatResponse(strings.NewReader(body)); answer != "" || !errors.Is(err, errAIResponseTooLarge) {
		t.Fatalf("answer=%q err=%v", answer, err)
	}
	app, _ := aiTestApp(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, body) }))
	defer server.Close()
	answer, err := app.callOpenAICompatibleWithSystemKey(context.Background(), server.URL, "model", "key", aiSystemPrompt, "edit")
	if answer != "" || !errors.Is(err, errAIResponseTooLarge) {
		t.Fatalf("answer=%q err=%v", answer, err)
	}
}

func TestAIIncompleteStreamDoesNotStartCompatibilityRetry(t *testing.T) {
	app, _ := aiTestApp(t)
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n")
	}))
	defer server.Close()
	answer, err := app.callOpenAICompatibleStreamWithKey(context.Background(), server.URL, "model", "key", "request", aiSystemPrompt, "edit")
	if answer != "" || !errors.Is(err, errAIResponseIncomplete) || requests != 1 {
		t.Fatalf("answer=%q err=%v requests=%d", answer, err, requests)
	}
}

func TestAICompleteJSONMislabeledAsSSE(t *testing.T) {
	app, _ := aiTestApp(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "{\n\"choices\":[{\"message\":{\"content\":\"answer\"}}]}\n")
	}))
	defer server.Close()
	answer, err := app.callOpenAICompatibleStreamWithKey(context.Background(), server.URL, "model", "key", "request", aiSystemPrompt, "edit")
	if err != nil || answer != "answer" {
		t.Fatalf("answer=%q err=%v", answer, err)
	}
}

func TestAIJSONDeltaWithoutCompletionIsRejected(t *testing.T) {
	body := `{"choices":[{"delta":{"content":"partial"}}]}`
	for _, streamed := range []bool{false, true} {
		var answer string
		var err error
		if streamed {
			answer, err = decodeAIEventStream(strings.NewReader(body), nil)
		} else {
			answer, err = decodeAIChatResponse(strings.NewReader(body))
		}
		if answer != "" || !errors.Is(err, errAIResponseIncomplete) {
			t.Fatalf("streamed=%t answer=%q err=%v", streamed, answer, err)
		}
	}
}

type canceledAIReader struct{}

func (canceledAIReader) Read([]byte) (int, error) { return 0, context.Canceled }

func TestAIResponsePreservesCancellationIdentity(t *testing.T) {
	_, readErr := readAIResponse(canceledAIReader{})
	_, streamErr := decodeAIEventStream(canceledAIReader{}, nil)
	for _, err := range []error{readErr, streamErr} {
		if !errors.Is(err, context.Canceled) || !errors.Is(err, errAIResponseIncomplete) {
			t.Fatalf("cancellation identity lost: %v", err)
		}
	}
}
