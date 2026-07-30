# p100-5 Chat Import Notes

Date captured: 2026-07-30 (local)
Source host: shawna@p100-5
Runtime listener: 0.0.0.0:8000
Detected process: /opt/llama.cpp/bin/llama-server (systemd service)

## Source discovery summary

- Service unit: llama-server.service
- ExecStart: /usr/local/sbin/llama-server-start.sh
- Environment file: /etc/llama.cpp/server.env
- API style observed from history and runtime checks: OpenAI-compatible endpoints on port 8000
- Confirmed endpoint usage examples in history: /v1/models, /v1/chat/completions

## Imported files

- install-llama.sh
- llama-healthcheck.service
- llama-healthcheck.sh
- llama-server-start.sh
- llama-server.service
- README-llama-lan.md
- server.env
- system-prompt.txt

## SHA256 manifest

- install-llama.sh: 4F85C263A0F0A7085DBDB0B761036E85511E986E09B97BCABAACFCEE0784119C
- llama-healthcheck.service: 4F198ECC5C765E076A6EDA37F75B58EB408E77711B2AC6CB481B70AA285221EB
- llama-healthcheck.sh: 9C9079348F25898679EAE21970AA2CF1BC4992C9D4818424E210D4CC4F716D22
- llama-server-start.sh: 1671C9222A7F2A8AEE5B029BB56166484D5D37FB431E5EB403AFB39561485F94
- llama-server.service: A092A16877415FA5C30611F0FA057BB1ADF02F703F5AD2EF4369BB5ADD6BD011
- README-llama-lan.md: 1D539497EA0749A41C61E8741515CCA466CFB8353C88E3B9893DAD406D84C65B
- server.env: 16A0D7C5F462CABD7F3397020F709B2BAF6F75FFEE49AAA6FAC6CC656D1ACCD5
- system-prompt.txt: 29BB934353BEF4173C716EAAE1BEBF75C796B4BAA85EA78186249C6FC832A781

## Integration notes

- New chat UI is configured for native Ollama API usage.
- Electron proxy forwards existing renderer endpoints directly to Ollama endpoints without OpenAI translation.
- Default model server URL in UI is http://127.0.0.1:11434.
