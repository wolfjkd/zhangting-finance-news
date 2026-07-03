import requests
import json
import logging

logger = logging.getLogger('ztfi')


class AIAnalyzer:
    def analyze(self, title: str, content: str) -> dict:
        raise NotImplementedError

    @staticmethod
    def create(model_name: str, api_key: str, **kwargs) -> 'AIAnalyzer':
        if model_name == 'custom':
            api_url = kwargs.get('api_url', '')
            model_name_param = kwargs.get('model_name_param', '')
            return CustomAdapter(api_key, api_url, model_name_param)
        raise ValueError(f'不支持的模型: {model_name}')

    def _build_prompt(self, title: str, content: str) -> str:
        return f"""请作为专业财经分析师，深度分析以下财经新闻：

标题：{title}
内容：{content}

请严格返回JSON格式，不要包含任何Markdown格式或额外文字：
{{
  "category": "政策/资金/公司/宏观/行业/技术指标",
  "priority": "critical/high/medium/low",
  "sentiment": "positive/negative/neutral",
  "summary": "深度解读（不超过50字，必须提供标题和内容之外的额外洞察，如潜在影响、市场反应预期、投资启示等）",
  "confidence": 0.85
}}

说明：
- category: 选择最符合的分类
- priority: critical=重大影响, high=重要, medium=一般关注, low=普通
- sentiment: positive=利好, negative=利空, neutral=中性
- confidence: 你的判断置信度，0-1之间
- summary: 必须包含标题和内容中没有的分析、洞察或预测，不能只是重复标题内容"""


class CustomAdapter(AIAnalyzer):
    def __init__(self, api_key: str, api_url: str = None, model_name: str = None):
        self.api_key = api_key
        base_url = api_url or 'https://api.example.com/v1'
        if base_url and not base_url.endswith('/chat/completions'):
            base_url = base_url.rstrip('/') + '/chat/completions'
        self.base_url = base_url
        self.model_name = model_name or 'custom'

    def analyze(self, title: str, content: str) -> dict:
        try:
            prompt = self._build_prompt(title, content)
            response = requests.post(
                self.base_url,
                headers={
                    'Authorization': f'Bearer {self.api_key}',
                    'Content-Type': 'application/json'
                },
                json={
                    'model': self.model_name,
                    'messages': [{'role': 'user', 'content': prompt}],
                    'temperature': 0.3
                },
                timeout=15
            )
            result = response.json()
            if 'choices' in result and len(result['choices']) > 0:
                text = result['choices'][0]['message']['content'].strip()
                return self._parse_json_response(text)
            return {}
        except Exception as e:
            logger.error(f'自定义API调用失败: {e}')
            return {}

    def _parse_json_response(self, text: str) -> dict:
        try:
            text = text.replace('```json', '').replace('```', '').strip()
            return json.loads(text)
        except json.JSONDecodeError:
            logger.error(f'自定义API返回解析失败: {text}')
            return {}
