package wireless

import (
	"strings"
	"testing"
)

func TestParseMdnsServices(t *testing.T) {
	output := strings.Join([]string{
		"List of discovered mdns services",
		"adb-3B6F5PE7KFB5M797-pxQzQ1\t_adb-tls-connect._tcp\t192.168.1.5:41235",
		"studio-AbCd\t_adb-tls-pairing._tcp.\t192.168.1.5:37123",
	}, "\n")
	services := parseMdnsServices(output)
	if len(services) != 2 || services[0].Type != "_adb-tls-connect._tcp" || services[0].Address != "192.168.1.5:41235" ||
		services[1].Name != "studio-AbCd" || services[1].Type != "_adb-tls-pairing._tcp" {
		t.Fatalf("services = %+v", services)
	}
}

func TestAdbdPortCandidates(t *testing.T) {
	info := strings.Join([]string{
		"    inet 172.18.165.138/22 brd 172.18.167.255 scope global wlan0",
		"##PROP",
		"",
		"##NET",
		"  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
		"   0: 0000000000000000FFFF00000100007F:871D 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000 10103        0 2202031 1",
		"   4: 00000000000000000000000000000000:9B03 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  2000        0 3430753 1",
		"   5: 00000000000000000000000000000000:27A6 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000 10091        0 130843 1",
		"   0: 0100007F:27AC 00000000:0000 0A 00000000:00000000 00:00000000 00000000  2000        0 128507 1",
	}, "\n")
	ports := adbdPortCandidates(info)
	if len(ports) != 1 || ports[0] != "39683" {
		t.Fatalf("ports = %v", ports)
	}
	if got := adbdPortCandidates("##PROP\n41235\n##NET\n"); len(got) != 1 || got[0] != "41235" {
		t.Fatalf("prop ports = %v", got)
	}
}
