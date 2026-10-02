using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.Drawing;
using System.Threading;
using System.Diagnostics;
using Microsoft.Win32;

namespace FrameGit.Installer
{
    public class SetupWizardForm : Form
    {
        private Label lblHeaderTitle;
        private Label lblHeaderSubtitle;
        private Panel panelHeader;
        private Label lblDest;
        private TextBox txtInstallPath;
        private Button btnBrowse;
        private CheckBox chkPath;
        private CheckBox chkDesktop;
        private CheckBox chkPlugins;
        private ProgressBar progressBar;
        private Label lblStatus;
        private Button btnInstall;
        private Button btnClose;

        private string defaultPath;

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        private static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);

        private const int HWND_BROADCAST = 0xffff;
        private const int WM_SETTINGCHANGE = 0x001A;
        private const int SMTO_ABORTIFHUNG = 0x0002;

        public SetupWizardForm()
        {
            InitializeComponent();
        }

        private void InitializeComponent()
        {
            this.Text = "FrameGit Setup";
            this.Size = new Size(540, 420);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.BackColor = Color.FromArgb(245, 245, 245);
            this.Font = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point);

            // Default Install Path: %LOCALAPPDATA%\Programs\FrameGit
            string localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            defaultPath = Path.Combine(localApp, "Programs", "FrameGit");

            // Header Panel
            panelHeader = new Panel();
            panelHeader.Dock = DockStyle.Top;
            panelHeader.Height = 70;
            panelHeader.BackColor = Color.FromArgb(26, 26, 26);
            panelHeader.Paint += (s, e) => {
                // Subtle blue accent line at bottom of header
                e.Graphics.FillRectangle(new SolidBrush(Color.FromArgb(0, 122, 204)), 0, panelHeader.Height - 3, panelHeader.Width, 3);
            };

            lblHeaderTitle = new Label();
            lblHeaderTitle.Text = "FrameGit — Version Control Setup";
            lblHeaderTitle.ForeColor = Color.White;
            lblHeaderTitle.Font = new Font("Segoe UI", 12F, FontStyle.Bold, GraphicsUnit.Point);
            lblHeaderTitle.Location = new Point(20, 12);
            lblHeaderTitle.AutoSize = true;
            panelHeader.Controls.Add(lblHeaderTitle);

            lblHeaderSubtitle = new Label();
            lblHeaderSubtitle.Text = "Post-production version control for Premiere Pro & DaVinci Resolve";
            lblHeaderSubtitle.ForeColor = Color.FromArgb(170, 170, 170);
            lblHeaderSubtitle.Font = new Font("Segoe UI", 8.5F, FontStyle.Regular, GraphicsUnit.Point);
            lblHeaderSubtitle.Location = new Point(21, 38);
            lblHeaderSubtitle.AutoSize = true;
            panelHeader.Controls.Add(lblHeaderSubtitle);

            this.Controls.Add(panelHeader);

            // Destination Label
            lblDest = new Label();
            lblDest.Text = "Destination Folder:";
            lblDest.Location = new Point(25, 90);
            lblDest.AutoSize = true;
            this.Controls.Add(lblDest);

            // Destination Input
            txtInstallPath = new TextBox();
            txtInstallPath.Text = defaultPath;
            txtInstallPath.Location = new Point(25, 112);
            txtInstallPath.Size = new Size(380, 24);
            this.Controls.Add(txtInstallPath);

            // Browse Button
            btnBrowse = new Button();
            btnBrowse.Text = "Browse...";
            btnBrowse.Location = new Point(415, 110);
            btnBrowse.Size = new Size(85, 27);
            btnBrowse.Click += (s, e) => {
                FolderBrowserDialog dlg = new FolderBrowserDialog();
                dlg.SelectedPath = txtInstallPath.Text;
                if (dlg.ShowDialog() == DialogResult.OK)
                {
                    txtInstallPath.Text = dlg.SelectedPath;
                }
            };
            this.Controls.Add(btnBrowse);

            // Checkboxes
            chkPath = new CheckBox();
            chkPath.Text = "Add FrameGit to System PATH (enables 'framegit' in CMD and PowerShell)";
            chkPath.Location = new Point(25, 155);
            chkPath.Size = new Size(475, 22);
            chkPath.Checked = true;
            this.Controls.Add(chkPath);

            chkDesktop = new CheckBox();
            chkDesktop.Text = "Create FrameGit Desktop Shortcut";
            chkDesktop.Location = new Point(25, 182);
            chkDesktop.Size = new Size(475, 22);
            chkDesktop.Checked = true;
            this.Controls.Add(chkDesktop);

            chkPlugins = new CheckBox();
            chkPlugins.Text = "Automatically deploy extensions for Premiere Pro and DaVinci Resolve";
            chkPlugins.Location = new Point(25, 209);
            chkPlugins.Size = new Size(475, 22);
            chkPlugins.Checked = true;
            this.Controls.Add(chkPlugins);

            // Progress Bar
            progressBar = new ProgressBar();
            progressBar.Location = new Point(25, 250);
            progressBar.Size = new Size(475, 20);
            progressBar.Style = ProgressBarStyle.Continuous;
            this.Controls.Add(progressBar);

            // Status Label
            lblStatus = new Label();
            lblStatus.Text = "Ready to install.";
            lblStatus.Location = new Point(25, 278);
            lblStatus.Size = new Size(475, 20);
            lblStatus.ForeColor = Color.FromArgb(80, 80, 80);
            this.Controls.Add(lblStatus);

            // Bottom Buttons
            btnInstall = new Button();
            btnInstall.Text = "Install";
            btnInstall.Location = new Point(310, 325);
            btnInstall.Size = new Size(95, 32);
            btnInstall.BackColor = Color.FromArgb(0, 122, 204);
            btnInstall.ForeColor = Color.White;
            btnInstall.FlatStyle = FlatStyle.Flat;
            btnInstall.FlatAppearance.BorderSize = 0;
            btnInstall.Font = new Font("Segoe UI", 9F, FontStyle.Bold, GraphicsUnit.Point);
            btnInstall.Click += BtnInstall_Click;
            this.Controls.Add(btnInstall);

            btnClose = new Button();
            btnClose.Text = "Cancel";
            btnClose.Location = new Point(415, 325);
            btnClose.Size = new Size(85, 32);
            btnClose.Click += (s, e) => this.Close();
            this.Controls.Add(btnClose);
        }

        private void BtnInstall_Click(object sender, EventArgs e)
        {
            btnInstall.Enabled = false;
            btnBrowse.Enabled = false;
            txtInstallPath.Enabled = false;
            chkPath.Enabled = false;
            chkDesktop.Enabled = false;
            chkPlugins.Enabled = false;

            string targetDir = txtInstallPath.Text.Trim();
            bool addToPath = chkPath.Checked;
            bool createDesktop = chkDesktop.Checked;
            bool autoPlugins = chkPlugins.Checked;

            Thread worker = new Thread(() => {
                try
                {
                    PerformInstall(targetDir, addToPath, createDesktop, autoPlugins,
                        (pct, msg) => {
                            this.Invoke(new Action(() => {
                                progressBar.Value = pct;
                                lblStatus.Text = msg;
                            }));
                        },
                        (success, errMsg) => {
                            this.Invoke(new Action(() => {
                                if (success)
                                {
                                    progressBar.Value = 100;
                                    lblStatus.Text = "Installation completed successfully!";
                                    lblStatus.ForeColor = Color.FromArgb(35, 134, 54);
                                    btnInstall.Text = "Launch";
                                    btnInstall.Enabled = true;
                                    btnInstall.Click -= BtnInstall_Click;
                                    btnInstall.Click += (s, ev) => {
                                        string exePath = Path.Combine(targetDir, "framegit.exe");
                                        if (File.Exists(exePath))
                                        {
                                            Process.Start(new ProcessStartInfo(exePath, "desktop") { UseShellExecute = true });
                                        }
                                        this.Close();
                                    };
                                    btnClose.Text = "Close";
                                }
                                else
                                {
                                    lblStatus.Text = "Error: " + errMsg;
                                    lblStatus.ForeColor = Color.Red;
                                    btnInstall.Enabled = true;
                                }
                            }));
                        });
                }
                catch (Exception ex)
                {
                    this.Invoke(new Action(() => {
                        lblStatus.Text = "Error: " + ex.Message;
                        lblStatus.ForeColor = Color.Red;
                        btnInstall.Enabled = true;
                    }));
                }
            });

            worker.IsBackground = true;
            worker.Start();
        }

        public static void PerformInstall(string targetDir, bool addToPath, bool createDesktop, bool autoPlugins, Action<int, string> progress, Action<bool, string> finish)
        {
            try
            {
                progress(10, "Creating destination folder...");
                if (!Directory.Exists(targetDir))
                {
                    Directory.CreateDirectory(targetDir);
                }

                progress(25, "Extracting payload files...");
                Assembly assembly = Assembly.GetExecutingAssembly();
                using (Stream stream = assembly.GetManifestResourceStream("payload.zip"))
                {
                    if (stream == null)
                    {
                        finish(false, "Embedded payload resource 'payload.zip' not found.");
                        return;
                    }

                    string tempZip = Path.Combine(Path.GetTempPath(), "framegit_setup_" + Guid.NewGuid().ToString("N") + ".zip");
                    using (FileStream fs = new FileStream(tempZip, FileMode.Create, FileAccess.Write))
                    {
                        stream.CopyTo(fs);
                    }

                    using (ZipArchive archive = ZipFile.OpenRead(tempZip))
                    {
                        foreach (ZipArchiveEntry entry in archive.Entries)
                        {
                            string destPath = Path.Combine(targetDir, entry.FullName);
                            string dir = Path.GetDirectoryName(destPath);
                            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                            {
                                Directory.CreateDirectory(dir);
                            }
                            if (!string.IsNullOrEmpty(entry.Name))
                            {
                                entry.ExtractToFile(destPath, true);
                            }
                        }
                    }

                    try { File.Delete(tempZip); } catch { }
                }

                progress(60, "Configuring system environment...");
                if (addToPath)
                {
                    AddDirectoryToUserPath(targetDir);
                }

                progress(75, "Creating shortcuts...");
                string exePath = Path.Combine(targetDir, "framegit.exe");
                if (createDesktop && File.Exists(exePath))
                {
                    string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                    string lnk = Path.Combine(desktop, "FrameGit.lnk");
                    CreateShortcut(lnk, exePath, "desktop", "FrameGit Desktop Application", targetDir);
                }

                // Start Menu shortcut
                string startMenu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs", "FrameGit");
                if (!Directory.Exists(startMenu)) Directory.CreateDirectory(startMenu);
                CreateShortcut(Path.Combine(startMenu, "FrameGit Desktop.lnk"), exePath, "desktop", "FrameGit Desktop", targetDir);
                CreateShortcut(Path.Combine(startMenu, "FrameGit CLI.lnk"), "powershell.exe", "-NoExit -Command \"Write-Host 'FrameGit CLI Ready.' -ForegroundColor Cyan; framegit --version\"", "FrameGit Terminal", targetDir);

                if (autoPlugins)
                {
                    progress(90, "Configuring creative application extensions...");
                    DeployEditorExtensions(targetDir);
                }

                progress(100, "Setup complete.");
                finish(true, null);
            }
            catch (Exception ex)
            {
                finish(false, ex.Message);
            }
        }

        private static void AddDirectoryToUserPath(string dir)
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey("Environment", true))
                {
                    if (key != null)
                    {
                        string currentPath = (string)key.GetValue("Path", "", RegistryValueOptions.DoNotExpandEnvironmentNames);
                        if (!currentPath.ToLower().Contains(dir.ToLower()))
                        {
                            string newPath = string.IsNullOrEmpty(currentPath) ? dir : currentPath.TrimEnd(';') + ";" + dir;
                            key.SetValue("Path", newPath, RegistryValueKind.ExpandString);

                            // Broadcast environment change to explorer
                            UIntPtr result;
                            SendMessageTimeout((IntPtr)HWND_BROADCAST, (uint)WM_SETTINGCHANGE, UIntPtr.Zero, "Environment", (uint)SMTO_ABORTIFHUNG, 3000, out result);
                        }
                    }
                }
            }
            catch { }
        }

        private static void CreateShortcut(string lnkPath, string targetPath, string args, string description, string workDir)
        {
            try
            {
                // Portable shortcut creation via PowerShell
                string script = string.Format(
                    "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('{0}'); $s.TargetPath = '{1}'; $s.Arguments = '{2}'; $s.Description = '{3}'; $s.WorkingDirectory = '{4}'; $s.Save()",
                    lnkPath.Replace("'", "''"),
                    targetPath.Replace("'", "''"),
                    args.Replace("'", "''"),
                    description.Replace("'", "''"),
                    workDir.Replace("'", "''")
                );

                ProcessStartInfo psi = new ProcessStartInfo("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -Command \"" + script + "\"")
                {
                    CreateNoWindow = true,
                    UseShellExecute = false
                };
                using (Process p = Process.Start(psi))
                {
                    p.WaitForExit(3000);
                }
            }
            catch { }
        }

        private static void DeployEditorExtensions(string targetDir)
        {
            try
            {
                string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);

                // 1. Resolve Module Script
                string resolveModuleSrc = Path.Combine(targetDir, "framegit_resolve.py");
                if (File.Exists(resolveModuleSrc))
                {
                    string resolveModuleDir = Path.Combine(appData, "Blackmagic Design", "DaVinci Resolve", "Support", "Developer", "Scripting", "Modules");
                    if (!Directory.Exists(resolveModuleDir)) Directory.CreateDirectory(resolveModuleDir);
                    File.Copy(resolveModuleSrc, Path.Combine(resolveModuleDir, "framegit_resolve.py"), true);
                }

                // 2. Premiere CCX
                string ccxSrc = Path.Combine(targetDir, "FrameGit-Premiere.ccx");
                if (File.Exists(ccxSrc))
                {
                    string premiereUxpDir = Path.Combine(appData, "Adobe", "UXP", "PluginsStorage", "PPRO");
                    if (!Directory.Exists(premiereUxpDir)) Directory.CreateDirectory(premiereUxpDir);
                    File.Copy(ccxSrc, Path.Combine(premiereUxpDir, "FrameGit-Premiere.ccx"), true);
                }
            }
            catch { }
        }

        [STAThread]
        public static int Main(string[] args)
        {
            bool isSilent = false;
            foreach (string arg in args)
            {
                if (arg.Equals("/S", StringComparison.OrdinalIgnoreCase) || arg.Equals("--silent", StringComparison.OrdinalIgnoreCase))
                {
                    isSilent = true;
                    break;
                }
            }

            if (isSilent)
            {
                string localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                string targetDir = Path.Combine(localApp, "Programs", "FrameGit");
                bool done = false;
                int exitCode = 0;

                PerformInstall(targetDir, true, true, true,
                    (p, m) => { },
                    (success, err) => {
                        done = true;
                        exitCode = success ? 0 : 1;
                    });

                while (!done) Thread.Sleep(100);
                return exitCode;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupWizardForm());
            return 0;
        }
    }
}
