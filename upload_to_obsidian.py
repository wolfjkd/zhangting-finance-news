import os
import re
import shutil

source_dirs = [
    r'C:\Users\wolfj\.trae-cn\memory',
    r'C:\Users\wolfj\.trae-cn\user_rules'
]
target_dir = r'D:\wolfjkd-OB\wolfjkd\Agent规则'

files_to_upload = [
    'user_profile.md',
    'identity.md',
    'project_dir_rule.md',
    'Quant_rules.md',
    'MEMORY.md',
    '免责声明.md',
    'AGENTS.md',
    'VERSION-CONTROL-RULES.md',
    'github_repos.md',
    'MIMO-CONFIG-RULES.md',
    'project_rules.md',
    '软件加密授权规则.md',
    '编程开发技术规则.md'
]

file_mapping = {
    'AGENTS.md': 'AGENTS.md',
    'VERSION-CONTROL-RULES.md': 'VERSION-CONTROL-RULES.md',
    'identity.md': 'identity.md',
    'github_repos.md': 'github_repos.md',
    'project_dir_rule.md': 'project_dir_rule.md',
    'user_profile.md': 'user_profile.md',
    'MEMORY.md': 'MEMORY.md',
    'MIMO-CONFIG-RULES.md': 'MIMO-CONFIG-RULES.md',
    'project_rules.md': 'project_rules.md',
    'Quant_rules.md': 'Quant_rules.md',
    '软件加密授权规则.md': '软件加密授权规则.md',
    '编程开发技术规则.md': '编程开发技术规则.md',
    '免责声明.md': '免责声明.md'
}

def convert_links(content):
    def replace_link(match):
        text = match.group(1)
        full_link = match.group(2)
        filename = os.path.basename(full_link.split('#')[0])
        if filename in file_mapping:
            return f'[[{file_mapping[filename]}|{text}]]'
        return match.group(0)
    
    content = re.sub(r'\[([^\]]+)\]\((file:///[^)]+\.md[^)]*)\)', replace_link, content)
    
    for old_name, new_name in file_mapping.items():
        content = content.replace(f'`{old_name}`', f'[[{new_name}]]')
    
    return content

os.makedirs(target_dir, exist_ok=True)

uploaded_files = []
for filename in files_to_upload:
    source_path = None
    for dir_path in source_dirs:
        candidate = os.path.join(dir_path, filename)
        if os.path.exists(candidate):
            source_path = candidate
            break
    
    if source_path is None:
        print(f'❌ 未找到文件: {filename}')
        continue
    
    with open(source_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    content = convert_links(content)
    
    target_path = os.path.join(target_dir, filename)
    with open(target_path, 'w', encoding='utf-8') as f:
        f.write(content)
    
    uploaded_files.append(filename)
    print(f'✅ 已上传: {filename}')

print(f'\n📊 上传完成，共 {len(uploaded_files)} 个文件')
print('📁 目标目录:', target_dir)
print('📄 文件列表:', uploaded_files)