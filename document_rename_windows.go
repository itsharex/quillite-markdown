//go:build windows

package main

import "os"

func moveDocumentNoReplace(source, target, revision string, info os.FileInfo) error {
	return isolateDocumentOriginal(source, target, revision, info)
}
