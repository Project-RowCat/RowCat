# CI-only (Windows release runner): runs one command line without administrative rights and exits
# with its exit code.
#
# The hosted runner's account is an administrator with UAC off, so everything it starts holds a full
# administrator token, which is not what a RowCat user runs with. Postgres refuses such a token
# outright ("Execution of PostgreSQL by a user with administrative permissions is not permitted"):
# a release from before the pg_ctl start could not even launch there, so the upgrade smoke never
# seeded its data. This starts the command under the token a standard user's session has: the same
# account, with Administrators and Power Users kept only as deny-only groups. That is the restricted
# token pg_ctl itself creates (src/bin/pg_ctl/pg_ctl.c, CreateRestrictedProcess). The runner's window
# station and desktop admit only Administrators, so the account itself is added to both first.
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
	[DllImport("user32.dll", SetLastError = true)] static extern IntPtr GetProcessWindowStation();
	[DllImport("user32.dll", SetLastError = true)] static extern IntPtr GetThreadDesktop(uint threadId);
	[DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
	[DllImport("advapi32.dll", SetLastError = true)] static extern uint GetSecurityInfo(IntPtr handle, int objectType, uint info, IntPtr owner, IntPtr group, out IntPtr dacl, IntPtr sacl, out IntPtr descriptor);
	[DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool ConvertSecurityDescriptorToStringSecurityDescriptor(IntPtr descriptor, uint revision, uint info, out IntPtr text, IntPtr length);
	[DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string text, uint revision, out IntPtr descriptor, IntPtr length);
	[DllImport("advapi32.dll", SetLastError = true)] static extern bool GetSecurityDescriptorDacl(IntPtr descriptor, out bool present, out IntPtr dacl, out bool defaulted);
	[DllImport("advapi32.dll", SetLastError = true)] static extern uint SetSecurityInfo(IntPtr handle, int objectType, uint info, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
	[DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
	[DllImport("advapi32.dll", SetLastError = true)] static extern bool SetTokenInformation(IntPtr token, int infoClass, ref IntPtr info, int length);

	const int TokenDefaultDacl = 6;

	// What pg_ctl's AddUserToTokenDacl does: objects the child creates for itself (its own process and
	// thread among them) take the token's default DACL, which otherwise admits only Administrators —
	// deny-only here — so the child could not open itself and died initialising (0xC0000142).
	static void AdmitInDefaultDacl(IntPtr token, string sid) {
		IntPtr descriptor, dacl;
		if (!ConvertStringSecurityDescriptorToSecurityDescriptor("D:(A;;GA;;;" + sid + ")(A;;GA;;;SY)", 1, out descriptor, IntPtr.Zero)) throw new System.ComponentModel.Win32Exception();
		bool present, defaulted;
		if (!GetSecurityDescriptorDacl(descriptor, out present, out dacl, out defaulted)) throw new System.ComponentModel.Win32Exception();
		if (!SetTokenInformation(token, TokenDefaultDacl, ref dacl, IntPtr.Size)) throw new System.ComponentModel.Win32Exception();
		LocalFree(descriptor);
	}

	const int SE_WINDOW_OBJECT = 7;
	const uint DACL_SECURITY_INFORMATION = 4;

	// The window station and desktop admit Administrators, which the restricted token holds only for
	// deny: without an entry for the account itself, the child cannot initialise (0xC0000142).
	static void Admit(IntPtr handle, string sid) {
		IntPtr dacl, descriptor, text, updated;
		uint error = GetSecurityInfo(handle, SE_WINDOW_OBJECT, DACL_SECURITY_INFORMATION, IntPtr.Zero, IntPtr.Zero, out dacl, IntPtr.Zero, out descriptor);
		if (error != 0) throw new System.ComponentModel.Win32Exception((int)error);
		if (!ConvertSecurityDescriptorToStringSecurityDescriptor(descriptor, 1, DACL_SECURITY_INFORMATION, out text, IntPtr.Zero)) throw new System.ComponentModel.Win32Exception();
		string sddl = Marshal.PtrToStringUni(text) + "(A;;GA;;;" + sid + ")";
		LocalFree(text); LocalFree(descriptor);
		if (!ConvertStringSecurityDescriptorToSecurityDescriptor(sddl, 1, out updated, IntPtr.Zero)) throw new System.ComponentModel.Win32Exception();
		bool present, defaulted;
		if (!GetSecurityDescriptorDacl(updated, out present, out dacl, out defaulted)) throw new System.ComponentModel.Win32Exception();
		error = SetSecurityInfo(handle, SE_WINDOW_OBJECT, DACL_SECURITY_INFORMATION, IntPtr.Zero, IntPtr.Zero, dacl, IntPtr.Zero);
		LocalFree(updated);
		if (error != 0) throw new System.ComponentModel.Win32Exception((int)error);
	}

	const uint TOKEN_ALL_ACCESS = 0xF01FF;
	const uint SE_GROUP_USE_FOR_DENY_ONLY = 0x10;
	const uint CREATE_NO_WINDOW = 0x08000000;

	public static int Run(string commandLine, string directory) {
		string user = System.Security.Principal.WindowsIdentity.GetCurrent().User.Value;
		Admit(GetProcessWindowStation(), user);
		Admit(GetThreadDesktop(GetCurrentThreadId()), user);
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
		AdmitInDefaultDacl(restricted, user);
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
