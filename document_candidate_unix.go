//go:build !windows

package main

import "os"

// POSIX rollback uses a create-only hard link and retains the original inode,
// including writes through any pre-existing external descriptors.
func prepareDocumentCandidate(original, candidate string) error {
	return os.Link(original, candidate)
}
