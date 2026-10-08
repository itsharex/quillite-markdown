package main

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

var aiImageHeader = regexp.MustCompile(`(?i)data:image/[a-z0-9.+-]+;base64,`)

type aiEmbeddedImage struct{ placeholder, value string }

func protectAIEmbeddedImages(text string) (string, []aiEmbeddedImage, error) {
	if len(text) > maxSupportedDocumentBytes {
		return "", nil, errors.New("AI_INPUT_TOO_LARGE: input exceeds document limit")
	}
	var result strings.Builder
	images := []aiEmbeddedImage{}
	cursor := 0
	for _, header := range aiImageHeader.FindAllStringIndex(text, -1) {
		if header[0] < cursor {
			continue
		}
		end := header[1]
		for end < len(text) {
			c := text[end]
			if !(c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '+' || c == '/' || c == '=') {
				break
			}
			end++
		}
		if end == header[1] {
			continue
		}
		placeholder := fmt.Sprintf("QUILLITE_BACKEND_IMAGE_%d", len(images)+1)
		for strings.Contains(text, placeholder) {
			placeholder = "_" + placeholder + "_"
		}
		result.WriteString(text[cursor:header[0]])
		result.WriteString(placeholder)
		images = append(images, aiEmbeddedImage{placeholder, text[header[0]:end]})
		cursor = end
	}
	result.WriteString(text[cursor:])
	return result.String(), images, nil
}

func restoreAIEmbeddedImages(text string, images []aiEmbeddedImage) (string, error) {
	if _, err := restoredAIImageSize(text, images); err != nil {
		return "", err
	}
	for _, image := range images {
		count := strings.Count(text, image.placeholder)
		if int64(len(text))+int64(count)*int64(len(image.value)-len(image.placeholder)) > maxSupportedDocumentBytes {
			return "", errors.New("AI_RESPONSE_TOO_LARGE: restored images exceed document limit")
		}
		text = strings.ReplaceAll(text, image.placeholder, image.value)
	}
	return text, nil
}

func restoredAIImageSize(text string, images []aiEmbeddedImage) (int64, error) {
	size := int64(len(text))
	for _, image := range images {
		size += int64(strings.Count(text, image.placeholder)) * int64(len(image.value)-len(image.placeholder))
	}
	if size > maxSupportedDocumentBytes {
		return 0, errors.New("AI_RESPONSE_TOO_LARGE: restored images exceed document limit")
	}
	return size, nil
}
