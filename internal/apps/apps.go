package apps

import "strings"

// AppDef mendefinisikan satu aplikasi yang bisa membuka file.
type AppDef struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Exec       string   `json:"exec"`
	Extensions []string `json:"extensions"`
}

// List mengembalikan daftar app yang cocok dengan extension tertentu.
// App dengan extension "*" selalu disertakan.
func List(ext string, apps []AppDef) []AppDef {
	ext = strings.ToLower(strings.TrimPrefix(ext, "."))
	result := []AppDef{}
	for _, app := range apps {
		for _, e := range app.Extensions {
			if e == "*" || strings.ToLower(e) == ext {
				result = append(result, app)
				break
			}
		}
	}
	return result
}
