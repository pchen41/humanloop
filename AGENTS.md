To headlessly invoke other agents:

codex: 
codex exec --skip-git-repo-check "prompt"

cursor: 
agent --trust -p "prompt"

kimi (via opencode): 
opencode run -m "opencode-go/kimi-k3.1-pro#high" "prompt"

Agents are pretty smart these days. When asking them for reviews, give them useful context but you dont need to overspecify.