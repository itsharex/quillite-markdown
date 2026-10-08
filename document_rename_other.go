//go:build !windows && !linux && !darwin

package main

import (
	"errors"
	"os"
)

func moveDocumentNoReplace(source, target, revision string, info os.FileInfo) error {
	return errors.New("DOCUMENT_RENAME_UNSUPPORTED: save a copy instead")
}
