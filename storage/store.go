package storage

import (
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/dgraph-io/badger/v4"
)

type BadgerStore struct {
	db *badger.DB
}

func NewBadgerStore(appName string) (*BadgerStore, error) {
	userConfigDir, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}

	configDir := filepath.Join(userConfigDir, appName)
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return nil, err
	}

	dbPath := filepath.Join(configDir, "badger")

	opts := badger.DefaultOptions(dbPath).WithLogger(nil)
	db, err := badger.Open(opts)
	if err != nil {
		return nil, err
	}

	return &BadgerStore{db: db}, nil
}

var ErrKeyNotFound = badger.ErrKeyNotFound

// Get 获取值并反序列化到 dest
func (s *BadgerStore) Get(key string, dest interface{}) error {
	return s.db.View(func(txn *badger.Txn) error {
		item, err := txn.Get([]byte(key))
		if err != nil {
			return err
		}

		return item.Value(func(val []byte) error {
			return json.Unmarshal(val, dest)
		})
	})
}

// GetString 获取字符串值，key 不存在时返回默认值
func (s *BadgerStore) GetString(key string, defaultValue string) string {
	var result string
	err := s.Get(key, &result)
	if err != nil {
		return defaultValue
	}
	return result
}

// GetInt 获取整数值，key 不存在时返回默认值
func (s *BadgerStore) GetInt(key string, defaultValue int) int {
	var result int
	err := s.Get(key, &result)
	if err != nil {
		return defaultValue
	}
	return result
}

// GetBool 获取布尔值，key 不存在时返回默认值
func (s *BadgerStore) GetBool(key string, defaultValue bool) bool {
	var result bool
	err := s.Get(key, &result)
	if err != nil {
		return defaultValue
	}
	return result
}

// Has 检查 key 是否存在
func (s *BadgerStore) Has(key string) bool {
	err := s.db.View(func(txn *badger.Txn) error {
		_, err := txn.Get([]byte(key))
		return err
	})
	return err == nil
}

// GetOrError 获取值，明确返回错误
func (s *BadgerStore) GetOrError(key string, dest interface{}) error {
	return s.Get(key, dest)
}

// Set 设置值
func (s *BadgerStore) Set(key string, value interface{}) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}

	return s.db.Update(func(txn *badger.Txn) error {
		return txn.Set([]byte(key), data)
	})
}

// Delete 删除 key
func (s *BadgerStore) Delete(key string) error {
	return s.db.Update(func(txn *badger.Txn) error {
		return txn.Delete([]byte(key))
	})
}

// GetAll 获取所有键值对
func (s *BadgerStore) GetAll() (map[string]interface{}, error) {
	result := make(map[string]interface{})

	err := s.db.View(func(txn *badger.Txn) error {
		opts := badger.DefaultIteratorOptions
		opts.PrefetchSize = 10
		it := txn.NewIterator(opts)
		defer it.Close()

		for it.Rewind(); it.Valid(); it.Next() {
			item := it.Item()
			key := string(item.Key())

			err := item.Value(func(val []byte) error {
				var value interface{}
				if err := json.Unmarshal(val, &value); err != nil {
					return err
				}
				result[key] = value
				return nil
			})

			if err != nil {
				return err
			}
		}
		return nil
	})

	return result, err
}

// Clear 清空所有数据
func (s *BadgerStore) Clear() error {
	return s.db.DropAll()
}

// Close 关闭数据库
func (s *BadgerStore) Close() error {
	return s.db.Close()
}
