//go:build windows

package main

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

var documentCopyFileW = windows.NewLazySystemDLL("kernel32.dll").NewProc("CopyFileW")

// The original remains isolated for rollback. A separate, create-only native
// copy preserves streams, attributes and ACLs without hard links, which cloud
// providers such as Synology Drive reject even on an NTFS volume.
func prepareDocumentCandidate(original, candidate string) error {
	source, err := windows.UTF16PtrFromString(original)
	if err != nil {
		return err
	}
	target, err := windows.UTF16PtrFromString(candidate)
	if err != nil {
		return err
	}
	ok, _, callErr := documentCopyFileW.Call(uintptr(unsafe.Pointer(source)), uintptr(unsafe.Pointer(target)), 1)
	if ok == 0 {
		return callErr
	}
	return nil
}
