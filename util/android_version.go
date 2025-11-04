package util

var versionMap = map[string]string{
	"10": "Android 2.3.3 - 2.3.7, Gingerbread, API 10",
	"11": "Android 3.0, Honeycomb, API 11",
	"12": "Android 3.1, Honeycomb, API 12",
	"13": "Android 3.2.x, Honeycomb, API 13",
	"14": "Android 4.0.3 - 4.0.4, Ice Cream Sandwich, API 14",
	"15": "Android 4.0.3 - 4.0.4, Ice Cream Sandwich, API 15",
	"16": "Android 4.1.x, Jelly Bean, API 16",
	"17": "Android 4.2.x, Jelly Bean, API 17",
	"18": "Android 4.3.x, Jelly Bean, API 18",
	"19": "Android 4.4 - 4.4.4, KitKat, API 19",
	"21": "Android 5.0, Lollipop, API 21",
	"22": "Android 5.1, Lollipop, API 22",
	"23": "Android 6.0, Marshmallow, API 23",
	"24": "Android 7.0, Nougat, API 24",
	"25": "Android 7.1, Nougat, API 25",
	"26": "Android 8.0, Oreo, API 26",
	"27": "Android 8.1, Oreo, API 27",
	"28": "Android 9.0, Pie, API 28",
	"29": "Android 10.0, Q, API 29",
	"30": "Android 11.0, R, API 30",
	"31": "Android 12.0, S, API 31",
	"32": "Android 12.1, S, API 32",
	"33": "Android 13.0, T, API 33",
	"34": "Android 14.0, U, API 34",
	"35": "Android 15.0, V, API 35",
	"36": "Android 16.0, W, API 36",
}

func GetVersionBuild(key string) string {
	if version, ok := versionMap[key]; ok {
		return version
	}
	return ""
}
