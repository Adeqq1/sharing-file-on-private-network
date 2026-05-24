//go:build !windows

package embed

import (
	"os/exec"
	"syscall"
)

// applyLowPriority mengatur SysProcAttr agar proses ffmpeg subtitle-extract
// berjalan dalam process group sendiri di Unix/Linux/macOS.
// Nice value (10) di-apply setelah Start() via applyNiceFunc.
// Harus dipanggil sebelum cmd.Start().
func applyLowPriority(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	// Setpgid = true agar proses anak punya process group sendiri.
	// Ini diperlukan agar Setpriority berlaku tepat pada PID anak.
	cmd.SysProcAttr.Setpgid = true
}

// applyNiceAfterStart mengatur nice value proses anak ke 10 (skala -20..19).
// Nice 10 cukup rendah agar proses transcode normal selalu menang saat CPU sibuk.
// Dipanggil setelah cmd.Start() karena PID baru tersedia setelah Start.
func applyNiceAfterStart(pid int) {
	// Abaikan error — kalau gagal (mis. permission), proses tetap jalan dengan
	// priority normal. Tidak fatal, hanya berarti tidak ada penghematan CPU.
	_ = syscall.Setpriority(syscall.PRIO_PROCESS, pid, 10)
}

// applyNiceFunc dipanggil di Extract() setelah cmd.Start().
var applyNiceFunc = applyNiceAfterStart
