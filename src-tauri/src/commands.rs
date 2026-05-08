use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

fn config_dir() -> PathBuf {
    let home = dirs::home_dir().expect("无法获取 home 目录");
    home.join(".config").join("opencode")
}

/// 新版 oh-my-open(agent) 配置：`~/.config/opencode/oh-my-openagent.json`（优先）
fn oh_my_openagent_path() -> PathBuf {
    config_dir().join("oh-my-openagent.json")
}

/// 旧版路径：`~/.config/opencode/oh-my-opencode.json`
fn oh_my_legacy_path() -> PathBuf {
    config_dir().join("oh-my-opencode.json")
}

fn auth_file() -> PathBuf {
    let home = dirs::home_dir().expect("无法获取 home 目录");
    home.join(".local")
        .join("share")
        .join("opencode")
        .join("auth.json")
}

#[derive(serde::Serialize)]
pub struct SkillFileInfo {
    path: String,
    size: u64,
}

#[derive(serde::Serialize)]
pub struct SkillSummary {
    name: String,
    updated_at: u64,
    files: Vec<SkillFileInfo>,
}

#[derive(serde::Serialize)]
pub struct SkillFileContent {
    path: String,
    content: String,
}

#[derive(serde::Serialize)]
pub struct SkillDetail {
    name: String,
    updated_at: u64,
    files: Vec<SkillFileContent>,
}

fn skills_dir() -> Result<PathBuf, String> {
    std::env::current_dir()
        .map(|dir| dir.join(".cursor").join("skills"))
        .map_err(|e| format!("获取项目目录失败: {}", e))
}

fn validate_skill_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("技能名称不能为空".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains('\0') {
        return Err("技能名称不能包含路径分隔符或非法字符".to_string());
    }
    if trimmed == "." || trimmed == ".." {
        return Err("无效的技能名称".to_string());
    }
    Ok(trimmed.to_string())
}

fn validate_skill_file_path(path: &str) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("技能文件路径不能为空".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains('\0') {
        return Err("技能文件必须位于技能目录顶层".to_string());
    }
    if trimmed == "." || trimmed == ".." {
        return Err("无效的技能文件路径".to_string());
    }
    let allowed = [".md", ".txt", ".json", ".yaml", ".yml", ".toml"];
    if !allowed.iter().any(|suffix| trimmed.ends_with(suffix)) {
        return Err("仅支持编辑 Markdown、文本、JSON、YAML 或 TOML 文件".to_string());
    }
    Ok(trimmed.to_string())
}

fn text_skill_files(skill_dir: &PathBuf) -> Result<Vec<SkillFileInfo>, String> {
    let mut files = Vec::new();
    if !skill_dir.exists() {
        return Ok(files);
    }
    let entries = fs::read_dir(skill_dir).map_err(|e| format!("读取技能目录失败: {}", e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|item| item.to_str()) else {
            continue;
        };
        if validate_skill_file_path(name).is_err() {
            continue;
        }
        let size = fs::metadata(&path).map(|metadata| metadata.len()).unwrap_or(0);
        files.push(SkillFileInfo {
            path: name.to_string(),
            size,
        });
    }
    files.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(files)
}

fn skill_updated_at(skill_dir: &PathBuf) -> u64 {
    fs::metadata(skill_dir)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

#[tauri::command]
pub fn read_auth() -> Result<String, String> {
    let path = auth_file();
    if !path.exists() {
        return Ok("{}".to_string());
    }
    fs::read_to_string(&path).map_err(|e| format!("读取 auth.json 失败: {}", e))
}

#[tauri::command]
pub fn read_config(filename: &str) -> Result<String, String> {
    if filename == "oh-my-opencode.json" {
        let new_path = oh_my_openagent_path();
        if new_path.exists() {
            return fs::read_to_string(&new_path).map_err(|e| {
                format!("读取 {} 失败: {}", filename, e)
            });
        }
        let legacy = oh_my_legacy_path();
        if legacy.exists() {
            return fs::read_to_string(&legacy).map_err(|e| {
                format!("读取 {} 失败: {}", filename, e)
            });
        }
        return Ok("{}".to_string());
    }
    let path = config_dir().join(filename);
    fs::read_to_string(&path).map_err(|e| format!("读取 {} 失败: {}", filename, e))
}

#[tauri::command]
pub fn write_config(filename: &str, content: &str) -> Result<(), String> {
    if filename == "oh-my-opencode.json" {
        let path = oh_my_openagent_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("创建配置目录失败: {}", e))?;
        }
        return fs::write(&path, content)
            .map_err(|e| format!("写入 {} 失败: {}", filename, e));
    }
    let path = config_dir().join(filename);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {}", e))?;
    }
    fs::write(&path, content).map_err(|e| format!("写入 {} 失败: {}", filename, e))
}

#[tauri::command]
pub fn config_file_exists(filename: &str) -> bool {
    if filename == "oh-my-opencode.json" {
        return oh_my_openagent_path().exists() || oh_my_legacy_path().exists();
    }
    config_dir().join(filename).exists()
}

#[tauri::command]
pub fn list_skills() -> Result<Vec<SkillSummary>, String> {
    let dir = skills_dir()?;
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut skills = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("读取 .cursor/skills 失败: {}", e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|item| item.to_str()) else {
            continue;
        };
        if validate_skill_name(name).is_err() {
            continue;
        }
        skills.push(SkillSummary {
            name: name.to_string(),
            updated_at: skill_updated_at(&path),
            files: text_skill_files(&path)?,
        });
    }
    skills.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(skills)
}

#[tauri::command]
pub fn read_skill(name: &str) -> Result<SkillDetail, String> {
    let skill_name = validate_skill_name(name)?;
    let skill_dir = skills_dir()?.join(&skill_name);
    if !skill_dir.exists() {
        return Err(format!("技能 {} 不存在", skill_name));
    }
    let mut files = Vec::new();
    for file in text_skill_files(&skill_dir)? {
        let path = skill_dir.join(&file.path);
        let content = fs::read_to_string(&path)
            .map_err(|e| format!("读取技能文件 {} 失败: {}", file.path, e))?;
        files.push(SkillFileContent {
            path: file.path,
            content,
        });
    }
    Ok(SkillDetail {
        name: skill_name,
        updated_at: skill_updated_at(&skill_dir),
        files,
    })
}

#[tauri::command]
pub fn create_skill(name: &str, content: &str) -> Result<(), String> {
    let skill_name = validate_skill_name(name)?;
    let skill_dir = skills_dir()?.join(&skill_name);
    if skill_dir.exists() {
        return Err(format!("技能 {} 已存在", skill_name));
    }
    fs::create_dir_all(&skill_dir).map_err(|e| format!("创建技能目录失败: {}", e))?;
    fs::write(skill_dir.join("SKILL.md"), content)
        .map_err(|e| format!("写入 SKILL.md 失败: {}", e))
}

#[tauri::command]
pub fn write_skill_file(name: &str, path: &str, content: &str) -> Result<(), String> {
    let skill_name = validate_skill_name(name)?;
    let file_path = validate_skill_file_path(path)?;
    let skill_dir = skills_dir()?.join(&skill_name);
    if !skill_dir.exists() {
        return Err(format!("技能 {} 不存在", skill_name));
    }
    fs::write(skill_dir.join(&file_path), content)
        .map_err(|e| format!("写入技能文件 {} 失败: {}", file_path, e))
}

/// 从 opencode zen 的 /models 端点获取模型列表（Rust 侧发起，绕过 CORS）
/// 返回 ["opencode/gpt-5.4", "opencode/claude-opus-4-6", ...] 格式的 JSON 字符串
#[tauri::command]
pub async fn fetch_zen_models(api_key: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://opencode.ai/zen/v1/models")
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| format!("请求 zen models 失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("zen models 返回 HTTP {}", resp.status()));
    }

    #[derive(serde::Deserialize)]
    struct ModelItem {
        id: String,
    }
    #[derive(serde::Deserialize)]
    struct ModelsResponse {
        data: Vec<ModelItem>,
    }

    let data: ModelsResponse = resp
        .json()
        .await
        .map_err(|e| format!("解析 zen models 响应失败: {}", e))?;

    let models: Vec<String> = data.data.iter().map(|m| format!("opencode/{}", m.id)).collect();
    serde_json::to_string(&models).map_err(|e| e.to_string())
}

/// 从 models.dev/api.json 获取指定 provider 的模型列表
/// 返回 ["providerName/modelId", ...] 格式的 JSON 字符串
#[tauri::command]
pub async fn fetch_models_dev(provider_ids: Vec<String>) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get("https://models.dev/api.json")
        .send()
        .await
        .map_err(|e| format!("请求 models.dev 失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("models.dev 返回 HTTP {}", resp.status()));
    }

    // models.dev 返回 { providerKey: { models: { modelId: { id, name, ... } } } }
    let full: HashMap<String, serde_json::Value> = resp
        .json()
        .await
        .map_err(|e| format!("解析 models.dev 响应失败: {}", e))?;

    let mut result: Vec<String> = Vec::new();
    for provider_id in &provider_ids {
        if let Some(provider) = full.get(provider_id) {
            if let Some(models) = provider.get("models").and_then(|m| m.as_object()) {
                for model_id in models.keys() {
                    result.push(format!("{}/{}", provider_id, model_id));
                }
            }
        }
    }

    serde_json::to_string(&result).map_err(|e| e.to_string())
}
