//go:build windows

package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows"
)

func TestDocumentCommitActiveWriterIsNotOverwritten(t *testing.T) {
	dir := t.TempDir()
	target, staged := filepath.Join(dir, "document.md"), filepath.Join(dir, "stage")
	os.WriteFile(target, []byte("external"), 0600)
	os.WriteFile(staged, []byte("editor"), 0600)
	f, err := os.OpenFile(target, os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err = commitDocumentReplacement(staged, target, documentRevision([]byte("external"))); !errors.Is(err, errDocumentConflict) {
		t.Fatalf("writer not excluded: %v", err)
	}
	assertDocumentBytes(t, target, "external")
}

func TestDocumentReplacementPreservesAlternateStream(t *testing.T) {
	p := filepath.Join(t.TempDir(), "document.md")
	if err := os.WriteFile(p, []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p+":user-metadata", []byte("keep me"), 0600); err != nil {
		t.Skipf("ADS unavailable: %v", err)
	}
	if err := writeDocumentAtomically(p, []byte("new")); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(p + ":user-metadata")
	if err != nil || string(data) != "keep me" {
		t.Fatalf("metadata lost: %q %v", data, err)
	}
}

func TestDocumentReplacementRejectsHardlinks(t *testing.T) {
	p := filepath.Join(t.TempDir(), "document.md")
	if err := os.WriteFile(p, []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(p, p+".link"); err != nil {
		t.Skip(err)
	}
	if err := writeDocumentAtomically(p, []byte("new")); err == nil {
		t.Fatal("hard-linked file replaced")
	}
	data, _ := os.ReadFile(p)
	if string(data) != "old" {
		t.Fatal("original modified")
	}
}

func TestFailedDocumentReplacementKeepsOriginal(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "document.md")
	if err := os.WriteFile(p, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := replaceDocumentFile(filepath.Join(dir, "missing.tmp"), p); err == nil {
		t.Fatal("missing replacement accepted")
	}
	data, err := os.ReadFile(p)
	if err != nil || string(data) != "original" {
		t.Fatalf("original lost: %q %v", data, err)
	}
}

func TestWindowsDocumentCandidateIsIndependentAndCreateOnly(t *testing.T) {
	dir := t.TempDir()
	original, candidate := filepath.Join(dir, "original"), filepath.Join(dir, "candidate")
	if err := os.WriteFile(original, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := prepareDocumentCandidate(original, candidate); err != nil {
		t.Fatal(err)
	}
	old, _ := os.Stat(original)
	copy, _ := os.Stat(candidate)
	if os.SameFile(old, copy) {
		t.Fatal("cloud documents must not create an original/candidate hard link")
	}
	for _, path := range []string{original, candidate} {
		f, err := os.Open(path)
		if err != nil {
			t.Fatal(err)
		}
		var info windows.ByHandleFileInformation
		err = windows.GetFileInformationByHandle(windows.Handle(f.Fd()), &info)
		f.Close()
		if err != nil || info.NumberOfLinks != 1 {
			t.Fatalf("hard link created: %+v %v", info, err)
		}
	}
	if err := os.WriteFile(candidate, []byte("external"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := prepareDocumentCandidate(original, candidate); err == nil {
		t.Fatal("copy overwrote an existing candidate")
	}
	assertDocumentBytes(t, candidate, "external")
	assertDocumentBytes(t, original, "original")
}

func TestWindowsExportAccessFailurePreservesExistingDOCX(t *testing.T) {
	path := filepath.Join(t.TempDir(), "locked-report.docx")
	if err := os.WriteFile(path, []byte("original export"), 0600); err != nil {
		t.Fatal(err)
	}
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := windows.CreateFile(name, windows.GENERIC_READ, windows.FILE_SHARE_READ, nil, windows.OPEN_EXISTING, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(handle)
	if err := writeFileAtomically(path, []byte("new export")); err == nil {
		t.Fatal("locked export target was overwritten")
	}
	assertDocumentBytes(t, path, "original export")
}
