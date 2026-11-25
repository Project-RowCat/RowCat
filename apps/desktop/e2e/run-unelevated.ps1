# CI-only (Windows release runner): runs one command line without administrative rights and exits
# with its exit code.
#
# The hosted runner's account is an administrator with UAC off, so everything it starts holds a full
# administrator token, which is not what a RowCat user runs with. Postgres refuses such a token
# outright ("Execution of PostgreSQL by a user with administrative permissions is not permitted"):
# a release from before the pg_ctl start could not even launch there, so the upgrade smoke never
# seeded its data. This starts the command under the token a standard user's session has: the same
# account, with Administrators and Power Users kept only as deny-only groups. That is the restricted
# token pg_ctl itself creates (src/bin/pg_ctl/pg_ctl.c, CreateRestrictedProcess).
#
# Output goes to the log file named by -Log (and is printed afterwards); a handle inherited across
# the token change is not something to rely on.
param(
	[Parameter(Mandatory = $true)][string]$CommandLine,
	[Parameter(Mandatory = $true)][string]$Log
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class Unelevated {
	[StructLayout(LayoutKind.Sequential)]
	struct SID_AND_ATTRIBUTES { public IntPtr Sid; public uint Attributes; }

	[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
	struct STARTUPINFO {
		public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
		public int dwX; public int dwY; public int dwXSize; public int dwYSize;
		public int dwXCountChars; public int dwYCountChars; public int dwFillAttribute;
		public int dwFlags; public short wShowWindow; public short cbReserved2;
		public IntPtr lpReserved2; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
	}

	[StructLayout(LayoutKind.Sequential)]
	struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }

	[DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
	[DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
	[DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool ConvertStringSidToSid(string sid, out IntPtr psid);
	[DllImport("advapi32.dll", SetLastError = true)] static extern bool CreateRestrictedToken(IntPtr existing, uint flags, uint disableCount, SID_AND_ATTRIBUTES[] disable, uint deleteCount, IntPtr delete, uint restrictCount, IntPtr restrict, out IntPtr token);
	[DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcessAsUser(IntPtr token, string application, string commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string directory, ref STARTUPINFO startup, out PROCESS_INFORMATION info);
	[DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
	[DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
	[DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

	const uint TOKEN_ALL_ACCESS = 0xF01FF;
	const uint SE_GROUP_USE_FOR_DENY_ONLY = 0x10;
	const uint CREATE_NO_WINDOW = 0x08000000;

	public static int Run(string commandLine, string directory) {
		IntPtr token;
		if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ALL_ACCESS, out token)) throw new System.ComponentModel.Win32Exception();
		IntPtr administrators, powerUsers;
		if (!ConvertStringSidToSid("S-1-5-32-544", out administrators) || !ConvertStringSidToSid("S-1-5-32-547", out powerUsers))
			throw new System.ComponentModel.Win32Exception();
		var disable = new[] {
			new SID_AND_ATTRIBUTES { Sid = administrators, Attributes = SE_GROUP_USE_FOR_DENY_ONLY },
			new SID_AND_ATTRIBUTES { Sid = powerUsers, Attributes = SE_GROUP_USE_FOR_DENY_ONLY },
		};
		IntPtr restricted;
		if (!CreateRestrictedToken(token, 0, 2, disable, 0, IntPtr.Zero, 0, IntPtr.Zero, out restricted)) throw new System.ComponentModel.Win32Exception();
		var startup = new STARTUPINFO();
		startup.cb = Marshal.SizeOf(typeof(STARTUPINFO));
		PROCESS_INFORMATION info;
		if (!CreateProcessAsUser(restricted, null, commandLine, IntPtr.Zero, IntPtr.Zero, false, CREATE_NO_WINDOW, IntPtr.Zero, directory, ref startup, out info))
			throw new System.ComponentModel.Win32Exception();
		WaitForSingleObject(info.hProcess, 0xFFFFFFFF);
		uint code;
		GetExitCodeProcess(info.hProcess, out code);
		CloseHandle(info.hThread); CloseHandle(info.hProcess); CloseHandle(restricted); CloseHandle(token);
		return (int)code;
	}
}
'@

$code = [Unelevated]::Run("cmd.exe /d /s /c `"$CommandLine > `"$Log`" 2>&1`"", (Get-Location).Path)
if (Test-Path $Log) { Get-Content $Log }
exit $code
