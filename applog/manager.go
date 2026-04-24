package applog

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	defaultMaxSizeMB     = 10
	defaultMaxBackups    = 5
	defaultChunkBytes    = 128 * 1024
	defaultFlushBytes    = 32 * 1024
	defaultFlushInterval = 100 * time.Millisecond
)

type FileInfo struct {
	Name      string
	Size      int64
	Modified  time.Time
	IsCurrent bool
}

type Chunk struct {
	FileName   string
	Content    string
	NextCursor int64
	HasMore    bool
	FileSize   int64
}

type Status struct {
	Directory   string
	CurrentFile string
	CurrentSize int64
	FileCount   int
	TotalSize   int64
}

type Manager struct {
	mu           sync.Mutex
	dir          string
	currentName  string
	currentPath  string
	archivePrefx string
	maxSizeBytes int64
	maxBackups   int
	file         *os.File
	size         int64
	pending      bytes.Buffer
	flushBytes   int
	flushEvery   time.Duration
	flushCh      chan struct{}
	stopCh       chan struct{}
	doneCh       chan struct{}
	closed       bool
}

func NewManager(appName string, mirrorStdout bool) (*Manager, error) {
	userConfigDir, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}

	logDir := filepath.Join(userConfigDir, appName, "logs")
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return nil, err
	}

	manager := &Manager{
		dir:          logDir,
		currentName:  "app.log",
		currentPath:  filepath.Join(logDir, "app.log"),
		archivePrefx: "app-",
		maxSizeBytes: defaultMaxSizeMB * 1024 * 1024,
		maxBackups:   defaultMaxBackups,
		flushBytes:   defaultFlushBytes,
		flushEvery:   defaultFlushInterval,
		flushCh:      make(chan struct{}, 1),
		stopCh:       make(chan struct{}),
		doneCh:       make(chan struct{}),
	}

	if err := manager.openCurrent(); err != nil {
		return nil, err
	}

	go manager.flushLoop()

	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	if mirrorStdout {
		log.SetOutput(io.MultiWriter(os.Stdout, manager))
	} else {
		log.SetOutput(manager)
	}

	return manager, nil
}

func (m *Manager) Directory() string {
	return m.dir
}

func (m *Manager) Write(p []byte) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.closed {
		return 0, fmt.Errorf("log manager is closed")
	}

	_, _ = m.pending.Write(p)
	shouldFlush := m.pending.Len() >= m.flushBytes

	if shouldFlush {
		m.signalFlushLocked()
	}

	return len(p), nil
}

func (m *Manager) Status() (Status, error) {
	if err := m.Flush(); err != nil {
		return Status{}, err
	}

	files, err := m.ListFiles()
	if err != nil {
		return Status{}, err
	}

	status := Status{
		Directory:   m.dir,
		CurrentFile: m.currentName,
		FileCount:   len(files),
	}

	for _, file := range files {
		status.TotalSize += file.Size
		if file.IsCurrent {
			status.CurrentSize = file.Size
		}
	}

	return status, nil
}

func (m *Manager) ListFiles() ([]FileInfo, error) {
	if err := m.Flush(); err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(m.dir)
	if err != nil {
		return nil, err
	}

	var files []FileInfo
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasSuffix(strings.ToLower(name), ".log") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return nil, err
		}
		files = append(files, FileInfo{
			Name:      name,
			Size:      info.Size(),
			Modified:  info.ModTime(),
			IsCurrent: name == m.currentName,
		})
	}

	sort.Slice(files, func(i, j int) bool {
		if files[i].IsCurrent != files[j].IsCurrent {
			return files[i].IsCurrent
		}
		return files[i].Modified.After(files[j].Modified)
	})

	return files, nil
}

func (m *Manager) ReadChunk(fileName string, cursor int64, maxBytes int64) (Chunk, error) {
	if err := m.Flush(); err != nil {
		return Chunk{}, err
	}

	path, err := m.resolveFile(fileName)
	if err != nil {
		return Chunk{}, err
	}

	if maxBytes <= 0 {
		maxBytes = defaultChunkBytes
	}

	file, err := os.Open(path)
	if err != nil {
		return Chunk{}, err
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return Chunk{}, err
	}

	size := info.Size()
	if size == 0 {
		return Chunk{FileName: filepath.Base(path), FileSize: 0}, nil
	}

	if cursor <= 0 || cursor > size {
		cursor = size
	}

	start := cursor - maxBytes
	if start < 0 {
		start = 0
	}

	buf := make([]byte, cursor-start)
	if _, err := file.ReadAt(buf, start); err != nil && err != io.EOF {
		return Chunk{}, err
	}

	trimmedStart := start
	if start > 0 {
		if newline := bytes.IndexByte(buf, '\n'); newline >= 0 {
			trimmedStart += int64(newline + 1)
			buf = buf[newline+1:]
		}
	}

	return Chunk{
		FileName:   filepath.Base(path),
		Content:    string(buf),
		NextCursor: trimmedStart,
		HasMore:    trimmedStart > 0,
		FileSize:   size,
	}, nil
}

func (m *Manager) ExportZip(destination string) error {
	if err := m.Flush(); err != nil {
		return err
	}

	files, err := m.ListFiles()
	if err != nil {
		return err
	}

	out, err := os.Create(destination)
	if err != nil {
		return err
	}
	defer out.Close()

	zipWriter := zip.NewWriter(out)
	defer zipWriter.Close()

	for _, file := range files {
		path := filepath.Join(m.dir, file.Name)
		writer, err := zipWriter.Create(file.Name)
		if err != nil {
			return err
		}

		src, err := os.Open(path)
		if err != nil {
			return err
		}

		if _, err := io.Copy(writer, src); err != nil {
			src.Close()
			return err
		}
		src.Close()
	}

	return nil
}

func (m *Manager) ClearFile(fileName string) error {
	if err := m.Flush(); err != nil {
		return err
	}

	path, err := m.resolveFile(fileName)
	if err != nil {
		return err
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if path == m.currentPath && m.file != nil {
		if err := m.file.Truncate(0); err != nil {
			return err
		}
		if _, err := m.file.Seek(0, 0); err != nil {
			return err
		}
		m.size = 0
		return nil
	}

	file, err := os.OpenFile(path, os.O_TRUNC|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	return file.Close()
}

func (m *Manager) Flush() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.flushPendingLocked()
}

func (m *Manager) Close() error {
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return nil
	}
	m.closed = true
	close(m.stopCh)
	m.mu.Unlock()

	<-m.doneCh

	m.mu.Lock()
	defer m.mu.Unlock()
	if m.file != nil {
		err := m.file.Close()
		m.file = nil
		return err
	}
	return nil
}

func (m *Manager) openCurrent() error {
	file, err := os.OpenFile(m.currentPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}

	info, err := file.Stat()
	if err != nil {
		file.Close()
		return err
	}

	m.file = file
	m.size = info.Size()
	return nil
}

func (m *Manager) flushLoop() {
	ticker := time.NewTicker(m.flushEvery)
	defer ticker.Stop()
	defer close(m.doneCh)

	for {
		select {
		case <-ticker.C:
			_ = m.Flush()
		case <-m.flushCh:
			_ = m.Flush()
		case <-m.stopCh:
			_ = m.Flush()
			return
		}
	}
}

func (m *Manager) rotateLocked() error {
	if m.file != nil {
		if err := m.file.Close(); err != nil {
			return err
		}
		m.file = nil
	}

	archivePath := filepath.Join(m.dir, fmt.Sprintf("%s%s.log", m.archivePrefx, time.Now().Format("20060102-150405")))
	if err := os.Rename(m.currentPath, archivePath); err != nil && !os.IsNotExist(err) {
		return err
	}

	if err := m.openCurrent(); err != nil {
		return err
	}

	return m.pruneLocked()
}

func (m *Manager) pruneLocked() error {
	files, err := m.ListFiles()
	if err != nil {
		return err
	}

	backups := make([]FileInfo, 0, len(files))
	for _, file := range files {
		if !file.IsCurrent {
			backups = append(backups, file)
		}
	}

	if len(backups) <= m.maxBackups {
		return nil
	}

	for _, file := range backups[m.maxBackups:] {
		if err := os.Remove(filepath.Join(m.dir, file.Name)); err != nil {
			return err
		}
	}

	return nil
}

func (m *Manager) flushPendingLocked() error {
	if m.pending.Len() == 0 {
		return nil
	}

	if m.file == nil {
		if err := m.openCurrent(); err != nil {
			return err
		}
	}

	data := append([]byte(nil), m.pending.Bytes()...)
	m.pending.Reset()

	if m.size > 0 && m.size+int64(len(data)) > m.maxSizeBytes {
		if err := m.rotateLocked(); err != nil {
			return err
		}
	}

	n, err := m.file.Write(data)
	m.size += int64(n)
	return err
}

func (m *Manager) signalFlushLocked() {
	select {
	case m.flushCh <- struct{}{}:
	default:
	}
}

func (m *Manager) resolveFile(fileName string) (string, error) {
	name := filepath.Base(strings.TrimSpace(fileName))
	if name == "." || name == "" {
		name = m.currentName
	}

	path := filepath.Join(m.dir, name)
	if filepath.Dir(path) != m.dir {
		return "", fmt.Errorf("invalid log file")
	}

	if _, err := os.Stat(path); err != nil {
		return "", err
	}

	return path, nil
}
