import os
import sys
from dotenv import load_dotenv
from openai import OpenAI

# Load environment variables from .env file
# Try loading from current directory or parent directories
current_dir = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(current_dir, '.env'))

# Configuration
API_KEY = os.environ.get("API_KEY")
BASE_URL = "https://foundation-models.api.cloud.ru/v1"
MODEL_NAME = "ai-sage/GigaChat3-10B-A1.8B"

if not API_KEY:
    # Fallback for when running from extension root vs llm dir
    load_dotenv(os.path.join(os.path.dirname(current_dir), 'llm', '.env'))
    API_KEY = os.environ.get("API_KEY")

if not API_KEY and __name__ == "__main__":
    print("Ошибка: API_KEY не найден в файле .env")
    exit(1)

class GigaChatBot:
    def __init__(self):
        if not API_KEY:
            raise ValueError("API_KEY not found")
            
        self.client = OpenAI(
            api_key=API_KEY,
            base_url=BASE_URL
        )
        self.system_prompt = '''

Ты — Т-Покупач, нейтральный финансовый наставник.
Ты должен вести себя вежливо. И помочь пользователю разобраться для чего нужен этот товар.  
Твоя задача — определить, является ли покупка товара импульсивной, и принять решение: одобрить или отклонить покупку.
Входные данные
Ты получаешь:
ссылку на товар с торговой площадки,
причину, по которой товар был отправлен на аргументацию (например: «запретная категория», «превышает лимит пользователя»).
Ты обязан:
Прочитать информацию о товаре по ссылке (используя встроенные инструменты модели, если они есть).
Определить название товара.
Понять контекст причины отправки.
Количество вопросов которые ты можешь задать не больше 5!
Всегда твоё 6 сообщение должно содержать результат
Формат общения:
Ты строго следуешь методике «5 почему».
Сообщения 2–5 (от ИИ)
Ты задаёшь последовательно вопросы №2, №3, №4 и №5.
Каждый новый вопрос должен начинаться со слова «Почему?» и задаётся только после ответа на предыдуший 
Каждый новый вопрос опираться на предыдущий ответ пользователя.
Требования:
Вопросы должны быть короткими, прямыми, уточняющими.
Следующий вопрос задаётся только если у тебя есть сомнения что товар пользователю действительно нужен
Не дави на пользователя, не навязывай мнение.
Оставайся максимально нейтральным.
Сообщение 6 (или раньше если ты посчитаешь аргумент пользователя действительно весомым) (финальное решение)
Ты делаешь вывод:
одобрить или отклонить покупку.
Отклоняй, если:
ответы пользователя противоречивы,
цель неясная,
пользователь отвечает общими фразами без реальной необходимости,
мотив связан эмоцией, а не пользой,
покупка не решает реальную проблему.
Одобряй, если:
у пользователя есть чёткая, осознанная причина,
товар закрывает объективную потребность,
мотивация логична и стабильна,
покупка заранее планировалась.

'''

    def get_response(self, messages, context=None):
        """
        messages: list of {"role": "...", "content": "..."}
        context: dict {"title": "...", "price": "..."} (Optional, for first interaction)
        """
        
        # Prepare the full message history
        full_messages = [{"role": "system", "content": self.system_prompt}]
        
        # Injections for context
        if context:
            # We inject a fake user message telling the bot context, so it knows what to ask about.
            # But the user shouldn't see this. It's "hidden prompt".
            setup_msg = f"Пользователь хочет купить товар: {context.get('title', 'Unknown')} по цене {context.get('price', 'Unknown')}. Спроси его, зачем ему это нужно."
            full_messages.append({"role": "system", "content": setup_msg})
            
        # Append existing conversation history
        full_messages.extend(messages)

        try:
            response = self.client.chat.completions.create(
                model=MODEL_NAME,
                max_tokens=1000, # Reduced from 2500 for speed
                temperature=0.6,
                presence_penalty=0, 
                messages=full_messages
            )
            return response.choices[0].message.content
        except Exception as e:
            return f"Ошибка AI: {str(e)}"

# CLI Wrapper for backward compatibility / testing
def start_cli_chat():
    bot = GigaChatBot()
    print("\n--- Чат с GigaChat начат (CLI Mode) ---")
    messages = []
    
    while True:
        user_input = input("\nВы: ").strip()
        if user_input.lower() in ["exit", "quit"]: break
        if not user_input: continue

        messages.append({"role": "user", "content": user_input})
        response = bot.get_response(messages)
        print(f"GigaChat: {response}")
        messages.append({"role": "assistant", "content": response})

if __name__ == "__main__":
    start_cli_chat()
