import * as vscode from 'vscode';

/** Runtime UI strings (toasts, prompts, errors, picker labels). */
const en: Record<string, string> = {
	// Model picker
	'model.glm-4.7.detail': 'Legacy model',
	'model.glm-4.7.tooltip':
		'Legacy model. GLM-4.7 — 200K context, strong agentic coding and reasoning. Available on Coding Plan and Standard API.',
	'model.glm-5.detail': 'Legacy model',
	'model.glm-5.tooltip': 'Legacy model. GLM-5 — 200K context, advanced reasoning and coding. Standard API only.',
	'model.glm-5.1.detail': 'Legacy model',
	'model.glm-5.1.tooltip': 'Legacy model. GLM-5.1 — latest GLM-5 series, 200K context. Standard API only.',
	'model.glm-5.2.detail': 'Flagship coding model, 1M context',
	'model.glm-5.2.tooltip':
		'GLM-5.2 — flagship GLM coding model, 1M context, selectable thinking effort. Available on Coding Plan and Standard API.',
	'model.glm-4.5-air.detail': 'Legacy model',
	'model.glm-4.5-air.tooltip': 'Legacy model. GLM-4.5 Air — lightweight, fast, and low-cost. Available on both plans.',
	'model.custom.detail': 'Custom model',

	// Auth
	'auth.apiKeyRequiredDetail': 'Run "GLM: Set API Key" to configure.',
	'auth.prompt':
		'Enter your GLM API key (format: id.secret). Coding Plan keys come from z.ai; standard keys from the GLM Open Platform.',
	'auth.placeholder': 'your-id.your-secret',
	'auth.emptyValidation': 'API key cannot be empty',
	'auth.saved': 'GLM API key saved.',
	'auth.removed': 'GLM API key removed.',
	'auth.notConfigured': 'GLM API key not configured. Run "GLM: Set API Key" from the Command Palette.',

	// Thinking control
	'thinking.title': 'Thinking',
	'thinking.on': 'On',
	'thinking.off': 'Off',
	'thinking.on.desc': 'Enable step-by-step reasoning (recommended)',
	'thinking.off.desc': 'Disable reasoning for faster responses',

	// Thinking effort control
	'effort.title': 'Thinking Effort',
	'effort.none.label': 'None',
	'effort.none.desc': 'No reasoning — fastest, lowest quota',
	'effort.high.label': 'High',
	'effort.high.desc': 'Balanced reasoning (recommended)',
	'effort.max.label': 'Max',
	'effort.max.desc': 'Deepest reasoning — best for hard coding, uses more quota',

	// Request limits
	'request.toolsLimitExceeded':
		'GLM supports at most {0} tools in one request, but this request has {1}. Use VS Code Configure Tools to disable tools you rarely use.',
	'request.retry.rateLimited': 'GLM is rate limited. Retrying in {0}s ({1}/{2}).',
	'request.retry.busy': 'GLM is busy. Retrying in {0}s ({1}/{2}).',

	// Vision (GLM Vision MCP)
	'vision.progress.one': 'Analyzing the attached image with GLM Vision…',
	'vision.progress.many': 'Analyzing {0} attached images with GLM Vision…',
	'vision.notice.failed':
		'Note: image analysis failed ({0}), so this reply does not use the attached image(s).',
	'vision.error.empty': 'GLM Vision returned no description',
	'vision.error.unsupportedType': 'unsupported image type {0}',
	'vision.error.tooLarge': 'the image is larger than {0} MB',
	'vision.error.tooMany': 'more than {0} images attached at once',
	'vision.error.toolUnavailable': 'the GLM Vision server is not running',
	'vision.error.noKey': 'no GLM API key is configured',
	'vision.error.timeout': 'image analysis timed out',
	'vision.error.disabled': 'vision is turned off — run "GLM: Toggle Vision for Chat Models" to enable it',

	// GLM Vision MCP setup
	'visionMcp.install.alreadyInstalled': 'GLM Vision is already installed.',
	'visionMcp.install.consent': 'Install a third-party MCP server?',
	'visionMcp.install.consentDetail':
		'{0} will be downloaded from npm and run as a local Node.js process. It receives your GLM API key and attached image paths, then sends image content to Z.AI or BigModel for analysis.\n\nEvery dependency is pinned with an integrity hash and npm install scripts are disabled, but running third-party code still carries risk. You can remove the package at any time with “GLM: Uninstall GLM Vision MCP Server”.',
	'visionMcp.install.confirm': 'I Understand, Install',
	'visionMcp.install.viewPackage': 'View npm Package',
	'visionMcp.install.progress': 'Installing verified {0}…',
	'visionMcp.install.failed': 'GLM Vision could not be installed. No MCP server was enabled.',
	'visionMcp.install.success':
		'GLM Vision installed locally from integrity-locked dependencies. It starts automatically with your next chat message.',
	'visionMcp.install.unsupported': 'GLM Vision requires a newer version of VS Code.',
	'visionMcp.showLogs': 'Show Logs',
	'visionMcp.auth.title': 'Set up GLM Vision',
	'visionMcp.auth.prompt':
		'Enter your GLM API key (format: id.secret). It is stored in VS Code Secret Storage and used only to run the local GLM Vision server.',
	'visionMcp.auth.required': 'GLM Vision needs your GLM API key to run.',
	'visionMcp.auth.enterKey': 'Enter API Key',
	'visionMcp.notNow': 'Not Now',
	'visionMcp.runtime.missing':
		'Node.js 18+ (22+ recommended) with npm was not found on PATH. GLM Vision cannot be installed securely without it.',
	'visionMcp.runtime.tooOld':
		'Node.js {0} was found, but GLM Vision requires Node.js {1}+ (22+ recommended).',
	'visionMcp.runtime.requirements': 'Requirements',
	'visionMcp.cancel': 'Cancel',
	'visionMcp.uninstall.done':
		'GLM Vision and its local npm package were removed. Chat models are text-only again.',
	'visionMcp.uninstall.cleanupFailed':
		'GLM Vision was disabled, but its local package files could not be removed. See the logs for details.',
	'visionMcp.ready': 'GLM Vision is running. Turn on image input for chat models?',
	'visionMcp.ready.enable': 'Enable Vision',
	'visionMcp.approval.guidance':
		'Vision is on. VS Code asks before GLM Vision runs analyze_image. To stop repeated prompts, open Tool Approval and enable “without approval” only for GLM Vision > analyze_image.',
	'visionMcp.approval.manage': 'Manage Tool Approval',
	'visionMcp.unhealthy':
		'GLM Vision stopped. Chat models still accept images, but new image analysis will fail until the server restarts.',
	'visionMcp.restart.region': 'Region changed — restart GLM Vision from the MCP server list to apply it.',
	'visionMcp.restart.apiKey': 'API key changed — restart GLM Vision from the MCP server list to apply it.',
	'visionMcp.openServers': 'Open MCP Servers',
	'visionMcp.editPrompt': 'Edit Vision Prompt',
	'visionMcp.resolveKeyRequired': 'GLM Vision cannot start without an API key.',
	'visionMcp.toggle.off': 'Vision off — chat models are text-only again.',
	'visionMcp.toggle.notRunning': 'GLM Vision is not running yet. Start it from the MCP server list, then try again.',

	// HTTP errors
	'error.http.400': '[{0}] Invalid request. Check the request parameters.',
	'error.http.401':
		'[{0}] Authentication failed. Check your GLM API key, or create one for your selected plan.',
	'error.http.401.withCreateApiKeyLink':
		'[{0}] Authentication failed. Check your GLM API key, or [create one]({1}).',
	'error.http.402': '[{0}] Your GLM balance or plan quota is used up. Check your plan or top up.',
	'error.http.404':
		'[{0}] Model or endpoint not found. Check your API Mode, Region, and model id settings.',
	'error.http.422': '[{0}] Invalid parameters. Check the request parameters.',
	'error.http.429': '[{0}] Too many requests. Slow down and try again.',
	'error.http.500': '[{0}] GLM server error. Retry after a short wait.',
	'error.http.503': '[{0}] GLM service is overloaded. Retry after a short wait.',
	'error.http.generic': '[{0}] The service returned an error response.',

	// Network errors
	'error.network.dns':
		'[{0}] DNS lookup failed. Check your network connection, firewall, proxy settings, or custom Base URL.',
	'error.network.unreachable':
		'[{0}] The target is unreachable or refused the connection. Check your Base URL, proxy, network, or firewall.',
	'error.network.interrupted':
		'[{0}] The connection was interrupted. Check your network, firewall, or proxy, or try again later.',
	'error.network.timeout':
		'[{0}] Connection timed out. Try again later, or check your network, firewall, or proxy.',
	'error.network.tls':
		'[{0}] TLS/certificate verification failed. Check your proxy settings, certificates, or custom Base URL.',
	'error.network.aborted':
		'[{0}] The request was aborted. If you did not cancel it, check your network or proxy, or try again later.',
	'error.network.protocol':
		'[{0}] The HTTP connection or response parsing failed. Check your proxy, custom Base URL, or service response.',
	'error.network.configuration':
		'[{0}] The request configuration is invalid. Check your custom Base URL or extension settings.',
	'error.network.generic':
		'[{0}] Network request failed. Check your network connection, firewall, proxy settings, or custom Base URL.',
	'error.unknown': 'GLM request failed: {0}',

	// Error action buttons
	'error.action.setApiKey': 'Set API Key',
	'error.action.createApiKey': 'Create API Key',
	'error.action.viewDetails': 'Show Logs',

	// Lifecycle
	'extension.activateFailed': 'GLM failed to activate. Run "GLM: Show Logs" for details.',

	// Usage status bar
	'usage.status.loading': 'Refreshing…',
	'usage.status.ok.short': '$(sparkle) GLM {0}%',
	'usage.status.no-data': 'No usage data for this key (Coding Plan required).',
	'usage.status.auth-error': 'API key invalid. Click to set your key.',
	'usage.status.network-error': 'Usage unavailable (offline).',
	'usage.status.server-error': 'Usage request failed. Try again later.',
	'usage.tooltip.lastUpdated': 'Last updated: {0}',
	'usage.tooltip.offline': 'Usage unavailable (offline). Showing last data.',
	'usage.metric.session': 'Session',
	'usage.metric.weekly': 'Weekly',
	'usage.metric.webSearches': 'Web Searches',
	'usage.metric.resetsAt': 'Resets: {0}',
	'usage.plan.label': 'Plan: {0}',
	'usage.plan.renewsAt': 'Renews: {0}',
	'usage.panel.title': 'GLM Usage',
	'usage.panel.refresh': 'Refresh',
	'usage.panel.setKey': 'Set API Key',
	'usage.panel.offline': 'Offline · showing last data',
	'usage.panel.unavailable': 'Usage unavailable. Use a Coding Plan or Standard API key (no `baseUrl` override) to view details.',
	'usage.metric.window.session': '5h rolling',
	'usage.metric.window.weekly': '7-day rolling',
	'usage.metric.window.webSearches': 'Monthly',
	'usage.metric.resetsIn': 'Resets in {0}',
	'usage.panel.lastUpdated': 'Last updated: {0}',
	'usage.balance.section': 'Account Balance',
	'usage.balance.available': 'Available',
	'usage.balance.recharged': 'Recharged',
	'usage.balance.spent': 'Spent',
	'usage.balance.gifted': 'Gifted',
	'usage.balance.frozen': 'Frozen',
	'usage.balance.packages': 'Token Packages',
};

const zh: Record<string, string> = {
	'model.glm-4.7.detail': '旧版模型',
	'model.glm-4.7.tooltip': '旧版模型。GLM-4.7 — 20 万上下文，强大的智能体编程与推理。编程计划和标准 API 均可用。',
	'model.glm-5.detail': '旧版模型',
	'model.glm-5.tooltip': '旧版模型。GLM-5 — 20 万上下文，先进的推理与编程。仅标准 API 可用。',
	'model.glm-5.1.detail': '旧版模型',
	'model.glm-5.1.tooltip': '旧版模型。GLM-5.1 — 最新 GLM-5 系列，20 万上下文。仅标准 API 可用。',
	'model.glm-5.2.detail': '旗舰编程模型，100 万上下文',
	'model.glm-5.2.tooltip': 'GLM-5.2 — 旗舰 GLM 编程模型，100 万上下文，可选思考强度。编程计划和标准 API 均可用。',
	'model.glm-4.5-air.detail': '旧版模型',
	'model.glm-4.5-air.tooltip': '旧版模型。GLM-4.5 Air — 轻量、快速、低成本。两种计划均可用。',
	'model.custom.detail': '自定义模型',

	'auth.apiKeyRequiredDetail': '请运行“GLM: Set API Key”进行配置。',
	'auth.prompt': '请输入你的 GLM API Key（格式：id.secret）。编程套餐密钥来自 z.ai；标准密钥来自 GLM 开放平台。',
	'auth.placeholder': 'your-id.your-secret',
	'auth.emptyValidation': 'API Key 不能为空',
	'auth.saved': 'GLM API Key 已保存。',
	'auth.removed': 'GLM API Key 已删除。',
	'auth.notConfigured': '尚未配置 GLM API Key。请在命令面板运行“GLM: Set API Key”。',

	'thinking.title': '思考',
	'thinking.on': '开启',
	'thinking.off': '关闭',
	'thinking.on.desc': '启用逐步推理（推荐）',
	'thinking.off.desc': '关闭推理以获得更快响应',

	'effort.title': '思考强度',
	'effort.none.label': '关闭',
	'effort.none.desc': '不进行推理——最快、消耗最低',
	'effort.high.label': '高',
	'effort.high.desc': '均衡推理（推荐）',
	'effort.max.label': '最高',
	'effort.max.desc': '最深入的推理——适合复杂编程，消耗更多额度',

	'request.toolsLimitExceeded':
		'GLM 单次请求最多支持 {0} 个工具，但本次请求包含 {1} 个。请使用 VS Code 的“配置工具”关闭不常用的工具。',
	'request.retry.rateLimited': 'GLM 请求过于频繁。将在 {0} 秒后重试（{1}/{2}）。',
	'request.retry.busy': 'GLM 服务繁忙。将在 {0} 秒后重试（{1}/{2}）。',

	// 视觉（GLM Vision MCP）
	'vision.progress.one': '正在使用 GLM Vision 分析附带的图片…',
	'vision.progress.many': '正在使用 GLM Vision 分析 {0} 张附带的图片…',
	'vision.notice.failed': '注意：图片分析失败（{0}），因此本次回复未使用所附图片。',
	'vision.error.empty': 'GLM Vision 未返回任何描述',
	'vision.error.unsupportedType': '不支持的图片类型 {0}',
	'vision.error.tooLarge': '图片大小超过 {0} MB',
	'vision.error.tooMany': '单次附带的图片超过 {0} 张',
	'vision.error.toolUnavailable': 'GLM Vision 服务器未在运行',
	'vision.error.noKey': '未配置 GLM API Key',
	'vision.error.timeout': '图片分析超时',
	'vision.error.disabled': '视觉功能已关闭，可运行“GLM: 切换聊天模型视觉能力”重新开启',

	// GLM Vision MCP 设置
	'visionMcp.install.alreadyInstalled': 'GLM Vision 已安装。',
	'visionMcp.install.consent': '要安装第三方 MCP 服务器吗？',
	'visionMcp.install.consentDetail':
		'{0} 将从 npm 下载，并作为本地 Node.js 进程运行。它会获得你的 GLM API Key 和所附图片的路径，再将图片内容发送到 Z.AI 或智谱开放平台进行分析。\n\n扩展会用完整性哈希锁定所有依赖，并禁用 npm 安装脚本，但运行第三方代码仍有风险。你可以随时运行“GLM: 卸载 GLM Vision MCP 服务器”移除该软件包。',
	'visionMcp.install.confirm': '了解风险并安装',
	'visionMcp.install.viewPackage': '查看 npm 软件包',
	'visionMcp.install.progress': '正在安装已验证的 {0}…',
	'visionMcp.install.failed': '无法安装 GLM Vision，未启用任何 MCP 服务器。',
	'visionMcp.install.success': 'GLM Vision 已通过完整性锁定的依赖安装到本地。它会在你发送下一条聊天消息时自动启动。',
	'visionMcp.install.unsupported': 'GLM Vision 需要更新版本的 VS Code。',
	'visionMcp.showLogs': '显示日志',
	'visionMcp.auth.title': '设置 GLM Vision',
	'visionMcp.auth.prompt': '请输入你的 GLM API Key（格式：id.secret）。密钥仅存储在 VS Code 密钥存储中，仅用于运行本地 GLM Vision 服务器。',
	'visionMcp.auth.required': 'GLM Vision 需要你的 GLM API Key 才能运行。',
	'visionMcp.auth.enterKey': '输入 API Key',
	'visionMcp.notNow': '暂不',
	'visionMcp.runtime.missing': '未在 PATH 中找到 Node.js 18+（推荐 22+）和 npm，无法安全安装 GLM Vision。',
	'visionMcp.runtime.tooOld': '检测到 Node.js {0}，但 GLM Vision 需要 Node.js {1} 及以上版本（推荐 22+）。',
	'visionMcp.runtime.requirements': '环境要求',
	'visionMcp.cancel': '取消',
	'visionMcp.uninstall.done': 'GLM Vision 及其本地 npm 软件包已移除。聊天模型已恢复为纯文本。',
	'visionMcp.uninstall.cleanupFailed': 'GLM Vision 已停用，但无法移除本地软件包文件。请查看日志了解详情。',
	'visionMcp.ready': 'GLM Vision 正在运行。要为聊天模型开启图片输入吗？',
	'visionMcp.ready.enable': '开启视觉',
	'visionMcp.approval.guidance':
		'视觉功能已开启。GLM Vision 运行 analyze_image 前，VS Code 会请求确认。若要停止重复提示，请打开“工具批准”，并仅为 GLM Vision > analyze_image 启用“无需批准”。',
	'visionMcp.approval.manage': '管理工具批准',
	'visionMcp.unhealthy': 'GLM Vision 已停止。聊天模型仍接受图片，但在服务器重新启动前，新的图片分析会失败。',
	'visionMcp.restart.region': '区域已更改——请在 MCP 服务器列表中重启 GLM Vision 以应用。',
	'visionMcp.restart.apiKey': 'API Key 已更改——请在 MCP 服务器列表中重启 GLM Vision 以应用。',
	'visionMcp.openServers': '打开 MCP 服务器',
	'visionMcp.editPrompt': '编辑视觉提示词',
	'visionMcp.resolveKeyRequired': '缺少 API Key，GLM Vision 无法启动。',
	'visionMcp.toggle.off': '视觉已关闭——聊天模型已恢复为纯文本。',
	'visionMcp.toggle.notRunning': 'GLM Vision 尚未运行。请先在 MCP 服务器列表中启动它，然后重试。',

	'error.http.400': '[{0}] 请求无效。请检查请求参数。',
	'error.http.401': '[{0}] 身份验证失败。请检查你的 GLM API Key，或为所选套餐创建一个。',
	'error.http.401.withCreateApiKeyLink': '[{0}] 身份验证失败。请检查你的 GLM API Key，或[创建一个]({1})。',
	'error.http.402': '[{0}] 你的 GLM 余额或套餐额度已用尽。请检查套餐或充值。',
	'error.http.404': '[{0}] 未找到模型或接口。请检查 API 模式、区域和模型 ID 设置。',
	'error.http.422': '[{0}] 参数无效。请检查请求参数。',
	'error.http.429': '[{0}] 请求过于频繁。请放慢速度后重试。',
	'error.http.500': '[{0}] GLM 服务器错误。请稍后重试。',
	'error.http.503': '[{0}] GLM 服务繁忙。请稍后重试。',
	'error.http.generic': '[{0}] 服务返回了错误响应。',

	'error.network.dns': '[{0}] DNS 解析失败。请检查网络连接、防火墙、代理设置或自定义 Base URL。',
	'error.network.unreachable': '[{0}] 目标不可达或拒绝连接。请检查 Base URL、代理、网络或防火墙。',
	'error.network.interrupted': '[{0}] 连接中断。请检查网络、防火墙或代理，或稍后重试。',
	'error.network.timeout': '[{0}] 连接超时。请稍后重试，或检查网络、防火墙或代理。',
	'error.network.tls': '[{0}] TLS/证书校验失败。请检查代理设置、证书或自定义 Base URL。',
	'error.network.aborted': '[{0}] 请求已中止。若非你主动取消，请检查网络或代理，或稍后重试。',
	'error.network.protocol': '[{0}] HTTP 连接或响应解析失败。请检查代理、自定义 Base URL 或服务响应。',
	'error.network.configuration': '[{0}] 请求配置无效。请检查自定义 Base URL 或扩展设置。',
	'error.network.generic': '[{0}] 网络请求失败。请检查网络连接、防火墙、代理设置或自定义 Base URL。',
	'error.unknown': 'GLM 请求失败：{0}',

	'error.action.setApiKey': '设置 API Key',
	'error.action.createApiKey': '创建 API Key',
	'error.action.viewDetails': '查看日志',

	'extension.activateFailed': 'GLM 激活失败。请运行“GLM: Show Logs”查看详情。',

	// 用量状态栏
	'usage.status.loading': '刷新中…',
	'usage.status.ok.short': '$(sparkle) GLM {0}%',
	'usage.status.no-data': '此密钥暂无用量数据（需要编程计划）。',
	'usage.status.auth-error': 'API 密钥无效。点击设置密钥。',
	'usage.status.network-error': '无法获取用量（离线）。',
	'usage.status.server-error': '用量请求失败，请稍后重试。',
	'usage.tooltip.lastUpdated': '最后更新：{0}',
	'usage.tooltip.offline': '无法获取用量（离线）。显示上次数据。',
	'usage.metric.session': '本次会话',
	'usage.metric.weekly': '本周',
	'usage.metric.webSearches': '网页搜索',
	'usage.metric.resetsAt': '重置时间：{0}',
	'usage.plan.label': '套餐：{0}',
	'usage.plan.renewsAt': '续期时间：{0}',
	'usage.panel.title': 'GLM 用量',
	'usage.panel.refresh': '刷新',
	'usage.panel.setKey': '设置 API 密钥',
	'usage.panel.offline': '离线 · 显示上次数据',
	'usage.panel.unavailable': '暂无用量数据。请使用编程计划或标准 API 密钥（未配置 baseUrl 覆盖时）以查看详情。',
	'usage.metric.window.session': '5 小时滚动',
	'usage.metric.window.weekly': '7 天滚动',
	'usage.metric.window.webSearches': '每月',
	'usage.metric.resetsIn': '{0} 后重置',
	'usage.panel.lastUpdated': '最后更新：{0}',
	'usage.balance.section': '账户余额',
	'usage.balance.available': '可用余额',
	'usage.balance.recharged': '累计充值',
	'usage.balance.spent': '累计消耗',
	'usage.balance.gifted': '赠送金额',
	'usage.balance.frozen': '冻结金额',
	'usage.balance.packages': '资源包',
};

function isZh(): boolean {
	return vscode.env.language.toLowerCase() === 'zh-cn';
}

/** Translate `key`, substituting `{0}`, `{1}`, … with `args`. */
export function t(key: string, ...args: string[]): string {
	const dict = isZh() ? zh : en;
	let text = dict[key] ?? en[key];
	if (text === undefined) {
		return key;
	}
	for (let i = 0; i < args.length; i++) {
		text = text.replaceAll(`{${i}}`, String(args[i]));
	}
	return text;
}
