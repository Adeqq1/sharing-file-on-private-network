//go:build windows

package embed

import (
	"os/exec"
	"syscall"
)

// belowNormalPriorityClass adalah Windows process priority class yang satu tingkat
// di bawah NORMAL_PRIORITY_CLASS. Proses dengan priority ini akan mengalah pada
// proses normal (mis. ffmpeg transcode) saat CPU sibuk.
const belowNormalPriorityClass = 0x00004000

// applyLowPriority mengatur CreationFlags agar proses ffmpeg subtitle-extract
// berjalan dengan BELOW_NORMAL_PRIORITY_CLASS di Windows.
// Harus dipanggil sebelum cmd.Start().
func applyLowPriority(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: belowNormalPriorityClass,
	}
}

// applyNiceFunc adalah no-op di Windows — priority sudah di-set via CreationFlags.
var applyNiceFunc func(pid int) = nil
