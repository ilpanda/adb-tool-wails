package i18n

import (
	"errors"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
)

func TestLanguageAndErrorWrapping(t *testing.T) {
	t.Cleanup(func() { SetLanguage("zh-CN") })
	SetLanguage("en")
	if got := T("保存截图"); got != "Save screenshot" {
		t.Fatal(got)
	}
	if got := T("raw adb output"); got != "raw adb output" {
		t.Fatal(got)
	}
	cause := errors.New("network offline")
	err := fmt.Errorf(T("下载失败：%w"), cause)
	if !errors.Is(err, cause) || err.Error() != "Download failed: network offline" {
		t.Fatal(err)
	}
	SetLanguage("zh-CN")
	if got := T("保存截图"); got != "保存截图" {
		t.Fatal(got)
	}
	SetLanguage("unsupported")
	if got := T("保存截图"); got != "Save screenshot" {
		t.Fatal(got)
	}
}

func TestCatalogCoverageAndFormats(t *testing.T) {
	format := regexp.MustCompile(`%(?:\.\d+)?[sdftvw]`)
	for key, value := range english {
		if value == "" || !reflect.DeepEqual(format.FindAllString(key, -1), format.FindAllString(value, -1)) {
			t.Errorf("invalid translation format: %q => %q", key, value)
		}
	}
	err := filepath.Walk("../..", func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			if strings.HasPrefix(info.Name(), ".") && info.Name() != ".." || info.Name() == "frontend" || info.Name() == "server" || info.Name() == "build" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		f, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
		if err != nil {
			return err
		}
		ast.Inspect(f, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok || len(call.Args) == 0 {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok || sel.Sel.Name != "T" {
				return true
			}
			pkg, ok := sel.X.(*ast.Ident)
			if !ok || pkg.Name != "i18n" {
				return true
			}
			lit, ok := call.Args[0].(*ast.BasicLit)
			if !ok {
				return true
			}
			key, err := strconv.Unquote(lit.Value)
			if err != nil {
				t.Fatal(err)
			}
			if _, ok := english[key]; !ok {
				t.Errorf("%s: missing translation %q", path, key)
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestConcurrentLanguageChanges(t *testing.T) {
	t.Cleanup(func() { SetLanguage("zh-CN") })
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				SetLanguage("en")
				got := T("保存截图")
				if got != "Save screenshot" && got != "保存截图" {
					t.Error(got)
				}
				SetLanguage("zh-CN")
			}
		}()
	}
	wg.Wait()
}
