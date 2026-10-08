//go:build darwin

package main

import (
	"golang.org/x/sys/unix"
	"os"
)

func moveDocumentNoReplace(source, target, revision string, info os.FileInfo) error {
	return unix.RenameatxNp(unix.AT_FDCWD, source, unix.AT_FDCWD, target, 4) // RENAME_EXCL
}
