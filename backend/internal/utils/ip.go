package utils

import (
	"net"
	"net/http"
	"os"
	"strings"
)

// ClientIP returns the caller's IP address without the port.
// X-Forwarded-For is only trusted when TRUST_PROXY=true (set it when the API runs behind
// Render / Railway / Nginx), otherwise anyone could fake the IP written to the audit trail.
func ClientIP(r *http.Request) string {
	if os.Getenv("TRUST_PROXY") == "true" {
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			if ip := strings.TrimSpace(strings.Split(fwd, ",")[0]); ip != "" {
				return ip
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
