path = 'c:/Users/omtaj/ai-digital-twin/fastapi-backend/app/services/llm_service.py'
with open(path, 'r', encoding='utf-8') as f:
    text = f.read()

text = text.replace(r're.sub(r\"\\\json\s*\"', r're.sub(r\"`json\s*\"')

with open(path, 'w', encoding='utf-8') as f:
    f.write(text)