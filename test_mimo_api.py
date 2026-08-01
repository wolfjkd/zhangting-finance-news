import requests
import json

API_KEY = input("请输入小米Mimo API密钥: ").strip()
BASE_URL = input("请输入Base URL (默认: https://token-plan-cn.xiaomimimo.com/v1): ").strip() or "https://token-plan-cn.xiaomimimo.com/v1"
MODEL_NAME = input("请输入模型名称 (默认: mimo-v2.5): ").strip() or "mimo-v2.5"

print("\n" + "="*60)
print(f"测试参数:")
print(f"  API_KEY: {API_KEY[:10]}...")
print(f"  BASE_URL: {BASE_URL}")
print(f"  MODEL_NAME: {MODEL_NAME}")
print("="*60 + "\n")

full_url = f"{BASE_URL}/chat/completions" if not BASE_URL.endswith('/chat/completions') else BASE_URL
print(f"完整请求URL: {full_url}")

headers = {
    'Authorization': f'Bearer {API_KEY}',
    'Content-Type': 'application/json'
}
print(f"请求Headers: {headers}")

prompt = """请分析以下财经新闻：
标题：央行宣布下调存款准备金率
内容：央行决定下调金融机构存款准备金率0.25个百分点

请严格返回JSON格式，不要包含任何Markdown格式或额外文字：
{
  "category": "政策/资金/公司/宏观/行业/技术指标",
  "priority": "critical/high/medium/low",
  "sentiment": "positive/negative/neutral",
  "summary": "一句话摘要（不超过30字）",
  "confidence": 0.85
}

说明：
- category: 选择最符合的分类
- priority: critical=重大影响, high=重要, medium=一般关注, low=普通
- sentiment: positive=利好, negative=利空, neutral=中性
- confidence: 你的判断置信度，0-1之间"""

data = {
    'model': MODEL_NAME,
    'messages': [{'role': 'user', 'content': prompt}],
    'temperature': 0.3
}
print(f"请求Body: {json.dumps(data, indent=2)}")

print("\n" + "-"*60)
print("正在发送请求...")
print("-"*60)

try:
    response = requests.post(full_url, headers=headers, json=data, timeout=30)
    print(f"\n响应状态码: {response.status_code}")
    print(f"响应Headers: {dict(response.headers)}")
    print(f"\n响应内容:")
    try:
        result = response.json()
        print(json.dumps(result, indent=2, ensure_ascii=False))
    except json.JSONDecodeError:
        print(response.text[:2000])
        
    if response.status_code != 200:
        print(f"\n❌ 请求失败，状态码: {response.status_code}")
    else:
        print("\n✅ 请求成功！")
        
except Exception as e:
    print(f"\n❌ 请求异常: {e}")
    import traceback
    traceback.print_exc()
