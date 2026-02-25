# Personal Research Assistant

An AI-powered personal research assistant built with the OpenAI API, Pydantic, and Gradio. The assistant is designed to work for a specific user, has access to callable tools, and runs as an interactive chat interface in the browser.

## How It Works

The assistant maintains a conversation loop through Gradio's `ChatInterface`. On each message it calls the OpenAI API with the available tools attached. If the model decides to call a tool, the app handles the dispatch, feeds the result back into the conversation, and keeps looping until the model returns a final text response.

Tool schemas are defined using **Pydantic models** — no hand-written JSON. The model's `model_json_schema()` method generates the schema automatically, keeping the definition and the function in sync.

## Tools

| Tool | Description |
|---|---|
| `send_email` | Sends an email to a specified recipient with a subject and body |

> Web search via Serper API is configured and coming next.

## Stack

- **OpenAI API** — `gpt-4o-mini` for completions and tool calling
- **Pydantic** — schema generation for tool definitions
- **Gradio** — browser-based chat UI
- **python-dotenv** — environment variable management

## Setup

```bash
pip install openai pydantic gradio python-dotenv requests
```

Create a `.env` file in the project root:

```
OPENAI_API_KEY=your_openai_key
X-API-KEY=your_serper_key
```

## Run

Open `main.ipynb` in Jupyter and run all cells. Gradio will launch a local server at `http://127.0.0.1:7860`.

## Project Structure

```
├── main.ipynb       # Main notebook
├── .env             # API keys (not committed)
└── README.md
```

## Roadmap

- [ ] Add web search tool via Serper API
- [ ] Add Wikipedia lookup tool
- [ ] Add arXiv paper search
- [ ] Wire up real SMTP for email sending
- [ ] Explore same implementation in raw API and LangChain for comparison
