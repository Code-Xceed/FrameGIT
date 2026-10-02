# Cloud Storage & GitHub Sync Setup

FrameGit uses a hybrid storage architecture:
1. **GitHub Git Data API**: Stores commit manifests, tree structures, tags, and PR review comments.
2. **S3-Compatible Object Storage**: Stores encrypted, deduplicated FastCDC binary chunks (video, audio, assets).

We strongly recommend **Cloudflare R2** because it provides **$0 egress fees** (bandwidth is completely free), a generous 10 GB free tier, and full S3 API compatibility.

---

## 1. Cloudflare R2 Setup (Recommended)

### Step 1: Create an R2 Bucket
1. Log in to your [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. In the left navigation, click **R2**.
3. Click **Create bucket**. Name it e.g. `my-framegit-vault`.
4. Leave all settings at default and click **Create Bucket**.

### Step 2: Generate S3 API Credentials
1. In the R2 Overview page, click **Manage R2 API Tokens** in the right sidebar.
2. Click **Create API Token**.
3. Permissions: Select **Object Read & Write**.
4. TTL: Choose your preferred expiration or "Forever".
5. Click **Create API Token**.
6. Copy the following three values:
   - **Access Key ID**
   - **Secret Access Key**
   - **Jurisdiction-specific endpoint URL** (looks like `https://<account_id>.r2.cloudflarestorage.com`)

### Step 3: Configure FrameGit
In your terminal, configure FrameGit using the encrypted vault:

```bash
# Set provider and bucket
framegit config set cloud.provider "r2"
framegit config set cloud.bucket "my-framegit-vault"
framegit config set cloud.endpoint "https://<account_id>.r2.cloudflarestorage.com"
framegit config set cloud.region "auto"

# Securely save credentials into AES-256-GCM encrypted vault
framegit config set-secret cloud.accessKeyId "YOUR_R2_ACCESS_KEY_ID"
framegit config set-secret cloud.secretAccessKey "YOUR_R2_SECRET_ACCESS_KEY"
```

---

## 2. AWS S3 Setup (Alternative)

If your studio uses AWS:
1. Create an S3 bucket (e.g. `post-studio-framegit`) in your preferred region (e.g. `us-east-1`).
2. Create an IAM User with `s3:PutObject`, `s3:GetObject`, `s3:HeadObject`, `s3:ListBucket`, `s3:AbortMultipartUpload` permissions on the bucket.
3. Configure FrameGit:
```bash
framegit config set cloud.provider "s3"
framegit config set cloud.bucket "post-studio-framegit"
framegit config set cloud.region "us-east-1"
framegit config set cloud.endpoint "https://s3.us-east-1.amazonaws.com"

framegit config set-secret cloud.accessKeyId "AKIAIOSFODNN7EXAMPLE"
framegit config set-secret cloud.secretAccessKey "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
```

---

## 3. GitHub API Setup

To link your project manifests to a GitHub repository:

### Step 1: Create a GitHub Personal Access Token (PAT)
1. Go to [GitHub Settings > Developer Settings > Personal Access Tokens > Fine-grained tokens](https://github.com/settings/tokens?type=beta).
2. Click **Generate new token**.
3. Name: `FrameGit Workstation`.
4. Repository access: Select your video project repository (e.g. `your-studio/commercial-2026`).
5. Permissions:
   - **Contents**: Read and Write
6. Click **Generate token** and copy the string (`github_pat_...`).

### Step 2: Store GitHub Token Securely
```bash
framegit config set github.metadataRepo "your-studio/commercial-2026"
framegit config set-secret github.token "github_pat_YourTokenHere"
```

---

## 4. Pushing and Pulling

Once configured, pushing uploads your deduplicated chunks to R2 and records commit references in GitHub:

```bash
# Push current branch
framegit push

# Push specific branch
framegit push color-grade
```

To sync changes made by another editor on your team:
```bash
framegit pull main
```

FrameGit will:
1. Download missing commit manifests.
2. Query remote chunk catalog and download only the missing delta chunks.
3. Reconstruct the latest project file and assets bit-for-bit into your workspace.
