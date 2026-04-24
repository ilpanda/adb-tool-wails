package applog

type FileDTO struct {
	Name       string `json:"name"`
	Size       int64  `json:"size"`
	ModifiedAt string `json:"modifiedAt"`
	IsCurrent  bool   `json:"isCurrent"`
}

type ChunkDTO struct {
	FileName   string `json:"fileName"`
	Content    string `json:"content"`
	NextCursor int64  `json:"nextCursor"`
	HasMore    bool   `json:"hasMore"`
	FileSize   int64  `json:"fileSize"`
}

type StatusDTO struct {
	Directory   string `json:"directory"`
	CurrentFile string `json:"currentFile"`
	CurrentSize int64  `json:"currentSize"`
	FileCount   int    `json:"fileCount"`
	TotalSize   int64  `json:"totalSize"`
}
