import * as vscode from 'vscode';

/** Runtime UI strings (toasts, prompts, errors, picker labels). */
const en: Record<string, string> = {
	'models.recommendation': 'Recommended for your API mode: {0}. Use it for new Chat and Copilot CLI conversations. Existing conversations keep their selection. Legacy models can be managed in settings.',
	'models.useRecommended': 'Use recommended default',
	'models.settings': 'Legacy model settings',
	'models.customEndpoint': 'Choose a model in the Chat or Copilot CLI picker. GLM cannot recommend a default for a custom endpoint or a replacement model definition.',
	'models.defaultFailed': 'Could not update chat.defaultModel. Check your organization policy and whether the settings file is writable.',
	'models.defaultSaved': 'New conversations will default to {0} in Chat and Copilot CLI where available. Existing conversations keep their selection. GLM will update this default when you change API mode; an explicit edit to chat.defaultModel takes precedence.',
	'models.defaultOverridden': 'Saved the recommendation for {0}, but a higher-priority setting controls the default. Check chat.defaultModel in settings.',
	// Model picker
	'model.glm-4.7.detail': 'Legacy model',
	'model.glm-4.7.tooltip':
		'GLM-4.7. Legacy model with a 200K-token context window. Available on Coding Plan and Standard API.',
	'model.glm-5.detail': 'Legacy model',
	'model.glm-5.tooltip': 'GLM-5. Legacy model with a 200K-token context window. Standard API only.',
	'model.glm-5.1.detail': 'Legacy model',
	'model.glm-5.1.tooltip': 'GLM-5.1. Legacy model with a 200K-token context window. Standard API only.',
	'model.glm-5.2.detail': 'Legacy model, 1M context',
	'model.glm-5.2.tooltip':
		'GLM-5.2. Legacy model with a 1M-token context window and selectable thinking effort. Available on Coding Plan and Standard API.',
	'model.glm-5.3.detail': 'Default coding model, 1M context',
	'model.glm-5.3.tooltip':
		'GLM-5.3. Default coding model with a 1M-token context window. Thinking is always on; choose Low, High, or Max effort (Max by default). Coding Plan only.',
	'model.glm-5.3-flash.detail': 'Multimodal model, 1M context',
	'model.glm-5.3-flash.tooltip':
		'GLM-5.3-Flash. 1M-token context window and native image input. Thinking is always on; choose Low, High, or Max effort (Max by default). Available on Coding Plan and Standard API.',
	'model.glm-5.3-flashx.detail': 'Multimodal model, 1M context',
	'model.glm-5.3-flashx.tooltip':
		'GLM-5.3-FlashX. 1M-token context window and native image input. Thinking is always on; choose Low, High, or Max effort (Max by default). Standard API only.',
	'model.glm-4.5-air.detail': 'Legacy model',
	'model.glm-4.5-air.tooltip': 'GLM-4.5 Air. Legacy model with a 128K-token context window. Available on Coding Plan and Standard API.',
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
	'effort.none.desc': 'Reasoning disabled',
	'effort.low.label': 'Low',
	'effort.low.desc': 'Lower reasoning effort',
	'effort.high.label': 'High',
	'effort.high.desc': 'Higher reasoning effort',
	'effort.max.label': 'Max',
	'effort.max.desc': 'Maximum reasoning effort',

	// Request limits
	'request.toolsLimitExceeded':
		'GLM supports at most {0} tools in one request, but this request has {1}. Use VS Code Configure Tools to disable tools you rarely use.',
	'request.retry.rateLimited': 'GLM is rate limited. Retrying in {0}s ({1}/{2}).',
	'request.retry.busy': 'GLM is busy. Retrying in {0}s ({1}/{2}).',

	// Image input
	'vision.progress.one': 'Analyzing the attached image with GLM-5.3-Flash…',
	'vision.progress.many': 'Analyzing {0} attached images with GLM-5.3-Flash…',
	'vision.notice.failed':
		'Note: some image analysis failed ({0}); the affected image content was omitted.',
	'vision.error.empty': 'GLM-5.3-Flash returned no image description',
	'vision.error.unsupportedType': 'unsupported image type {0}',
	'vision.error.tooLarge': 'the image is larger than {0} MB',
	'vision.error.tooMany': 'more than {0} images attached at once',
	'vision.error.noKey': 'no GLM chat API key is configured',
	'vision.error.timeout': 'image analysis timed out',
	'migration.visionCleanupFailed':
		'Some data from the retired image integration could not be removed. GLM will still start; see the logs for details.',

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
	'usage.panel.used': 'used',
	'usage.panel.session': '5-hour quota',
	'usage.panel.weekly': 'Weekly quota',
	'usage.panel.localTime': 'Expiry dates are shown in your local time.',
	'usage.reset.title': 'Reset cards',
	'usage.reset.type.fiveHour': '5-hour',
	'usage.reset.type.week': 'weekly',
	'usage.reset.group': '{0} reset cards',
	'usage.reset.available': '{0} available',
	'usage.reset.expires': 'Expires {0}',
	'usage.reset.use': 'Use a reset card',
	'usage.reset.processing': 'Processing reset…',
	'usage.reset.unavailable': 'Reset cards could not be loaded. Refresh to try again.',
	'usage.reset.none': 'No unexpired reset card of this type is available. Usage will be refreshed.',
	'usage.reset.confirm': 'Use one {0} reset card?',
	'usage.reset.confirmDetail': 'This consumes one {0} reset card for {1}. The selected card expires {2} (local time). This cannot be undone.',
	'usage.reset.confirmUse': 'Use reset card',
	'usage.reset.changed': 'The region, API mode, key, or selected card changed. Refresh and confirm again.',
	'usage.reset.failed': 'The reset could not be confirmed. Check the refreshed card count before trying again.',
	'usage.reset.success': 'The reset card was used.',
	'usage.balance.section': 'Account Balance',
	'usage.balance.available': 'Available',
	'usage.balance.recharged': 'Recharged',
	'usage.balance.spent': 'Spent',
	'usage.balance.gifted': 'Gifted',
	'usage.balance.frozen': 'Frozen',
	'usage.balance.packages': 'Token Packages',
	'usage.recovery.unavailable': 'No usable Coding Plan quota was found for the current key. You can check whether this key has Standard API credit.',
	'usage.recovery.exhausted': 'Your Coding Plan token quota is exhausted. You can check whether the current key has Standard API credit while you wait for the quota to reset.',
	'usage.recovery.checkStandard': 'Check Standard API',
	'usage.recovery.tooltip.unavailable': 'Coding Plan is unavailable for this key. Open GLM Usage to check Standard API.',
	'usage.recovery.tooltip.exhausted': 'Coding Plan token quota is exhausted. Open GLM Usage to check Standard API.',
	'usage.recovery.noCredit': 'No usable Standard API credit was found for the current key. API Mode and your key were not changed.',
	'usage.recovery.checkFailed': 'Standard API balance could not be checked. API Mode and your key were not changed.',
	'usage.recovery.modeChanged': 'GLM settings or the current key changed before the switch was confirmed. No additional change was made.',
	'usage.recovery.confirm': 'Switch to Standard API?',
	'usage.recovery.confirmDetail': 'Detected Standard API credit: {0}. Standard API is pay-as-you-go. This will change API Mode in {1} and refresh the available models. Coding-Plan-only models such as GLM-5.3 may disappear; choose a Standard-compatible model if needed. Balance does not guarantee access to every model.',
	'usage.recovery.switch': 'Switch to Standard API',
	'usage.recovery.scope.workspace': 'this workspace',
	'usage.recovery.scope.user': 'your user settings',
	'usage.recovery.openSettings': 'Open Settings',
	'usage.recovery.getStandardKey': 'Get Standard API Key',
	'usage.recovery.switchFailed': 'GLM could not change API Mode. No change was made.',
};

const zh: Record<string, string> = {
	'models.recommendation': '当前 API 模式推荐使用 {0}。可将其设为 Chat 和 Copilot CLI 新对话的默认模型。已有对话保留原选择，旧版模型可在设置中管理。',
	'models.useRecommended': '使用推荐默认模型',
	'models.settings': '旧版模型设置',
	'models.customEndpoint': '请在 Chat 或 Copilot CLI 中选择模型。自定义端点或替换的模型定义需要手动选择默认模型。',
	'models.defaultFailed': '无法更新 chat.defaultModel。请检查组织策略，以及设置文件是否可写。',
	'models.defaultSaved': 'Chat 和 Copilot CLI 支持时，新对话默认使用 {0}。已有对话保留原选择。更改 API 模式时，GLM 会更新此默认值；手动修改 chat.defaultModel 后，以你的设置为准。',
	'models.defaultOverridden': '已保存 {0} 的推荐设置，但默认模型受更高优先级设置控制。请检查 chat.defaultModel。',
	'model.glm-4.7.detail': '旧版模型',
	'model.glm-4.7.tooltip': 'GLM-4.7，旧版模型，20 万 token 上下文。编程计划和标准 API 均可用。',
	'model.glm-5.detail': '旧版模型',
	'model.glm-5.tooltip': 'GLM-5，旧版模型，20 万 token 上下文。仅标准 API 可用。',
	'model.glm-5.1.detail': '旧版模型',
	'model.glm-5.1.tooltip': 'GLM-5.1，旧版模型，20 万 token 上下文。仅标准 API 可用。',
	'model.glm-5.2.detail': '旧版模型，100 万上下文',
	'model.glm-5.2.tooltip': 'GLM-5.2，旧版模型，100 万 token 上下文，可选思考强度。编程计划和标准 API 均可用。',
	'model.glm-5.3.detail': '默认编程模型，100 万上下文',
	'model.glm-5.3.tooltip':
		'GLM-5.3，默认编程模型，100 万 token 上下文。思考始终开启，可选低、高或最高强度，默认为最高。仅编程计划可用。',
	'model.glm-5.3-flash.detail': '多模态模型，100 万上下文',
	'model.glm-5.3-flash.tooltip':
		'GLM-5.3-Flash，100 万 token 上下文，直接接收图片。思考始终开启，可选低、高或最高强度，默认为最高。编程计划和标准 API 均可用。',
	'model.glm-5.3-flashx.detail': '多模态模型，100 万上下文',
	'model.glm-5.3-flashx.tooltip':
		'GLM-5.3-FlashX，100 万 token 上下文，直接接收图片。思考始终开启，可选低、高或最高强度，默认为最高。仅标准 API 可用。',
	'model.glm-4.5-air.detail': '旧版模型',
	'model.glm-4.5-air.tooltip': 'GLM-4.5 Air，旧版模型，12.8 万 token 上下文。编程计划和标准 API 均可用。',
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
	'thinking.off.desc': '关闭逐步推理',

	'effort.title': '思考强度',
	'effort.none.label': '关闭',
	'effort.none.desc': '关闭推理',
	'effort.low.label': '低',
	'effort.low.desc': '较低推理强度',
	'effort.high.label': '高',
	'effort.high.desc': '较高推理强度',
	'effort.max.label': '最高',
	'effort.max.desc': '最高推理强度',

	'request.toolsLimitExceeded':
		'GLM 单次请求最多支持 {0} 个工具，但本次请求包含 {1} 个。请使用 VS Code 的“配置工具”关闭不常用的工具。',
	'request.retry.rateLimited': 'GLM 请求过于频繁。将在 {0} 秒后重试（{1}/{2}）。',
	'request.retry.busy': 'GLM 服务繁忙。将在 {0} 秒后重试（{1}/{2}）。',

	// 图片输入
	'vision.progress.one': '正在使用 GLM-5.3-Flash 分析附带的图片…',
	'vision.progress.many': '正在使用 GLM-5.3-Flash 分析 {0} 张附带的图片…',
	'vision.notice.failed': '注意：部分图片分析失败（{0}）；受影响的图片内容已省略。',
	'vision.error.empty': 'GLM-5.3-Flash 未返回图片描述',
	'vision.error.unsupportedType': '不支持的图片类型 {0}',
	'vision.error.tooLarge': '图片大小超过 {0} MB',
	'vision.error.tooMany': '单次附带的图片超过 {0} 张',
	'vision.error.noKey': '未配置 GLM 聊天 API Key',
	'vision.error.timeout': '图片分析超时',
	'migration.visionCleanupFailed': '旧图片集成的部分数据无法移除。GLM 仍会正常启动；详情请查看日志。',

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
	'usage.panel.used': '已用',
	'usage.panel.session': '五小时额度',
	'usage.panel.weekly': '周额度',
	'usage.panel.localTime': '到期日期以你的本地时间显示。',
	'usage.reset.title': '重置卡',
	'usage.reset.type.fiveHour': '五小时',
	'usage.reset.type.week': '周',
	'usage.reset.group': '{0}重置卡',
	'usage.reset.available': '{0} 次可用',
	'usage.reset.expires': '{0} 到期',
	'usage.reset.use': '使用一张重置卡',
	'usage.reset.processing': '正在处理重置…',
	'usage.reset.unavailable': '无法加载重置卡，请刷新后重试。',
	'usage.reset.none': '此类型暂无未过期的可用重置卡，将刷新用量。',
	'usage.reset.confirm': '使用一张{0}重置卡？',
	'usage.reset.confirmDetail': '将在 {1} 消耗一张{0}重置卡。所选卡于 {2} 到期（本地时间）。此操作无法撤销。',
	'usage.reset.confirmUse': '使用重置卡',
	'usage.reset.changed': '区域、API 模式、密钥或所选重置卡已变化，请刷新后重新确认。',
	'usage.reset.failed': '无法确认重置结果，请检查刷新后的卡片次数再决定是否重试。',
	'usage.reset.success': '重置卡已使用。',
	'usage.balance.section': '账户余额',
	'usage.balance.available': '可用余额',
	'usage.balance.recharged': '累计充值',
	'usage.balance.spent': '累计消耗',
	'usage.balance.gifted': '赠送金额',
	'usage.balance.frozen': '冻结金额',
	'usage.balance.packages': '资源包',
	'usage.recovery.unavailable': '当前密钥未找到可用的编程计划额度。你可以检查此密钥是否有标准 API 余额。',
	'usage.recovery.exhausted': '编程计划的 token 额度已用尽。在等待额度重置时，你可以检查当前密钥是否有标准 API 余额。',
	'usage.recovery.checkStandard': '检查标准 API',
	'usage.recovery.tooltip.unavailable': '当前密钥不可用于编程计划。打开 GLM 用量详情以检查标准 API。',
	'usage.recovery.tooltip.exhausted': '编程计划的 token 额度已用尽。打开 GLM 用量详情以检查标准 API。',
	'usage.recovery.noCredit': '当前密钥未找到可用的标准 API 余额。API 模式和密钥均未更改。',
	'usage.recovery.checkFailed': '无法检查标准 API 余额。API 模式和密钥均未更改。',
	'usage.recovery.modeChanged': '确认切换前 GLM 设置或当前密钥已发生变化，未执行其他更改。',
	'usage.recovery.confirm': '切换到标准 API？',
	'usage.recovery.confirmDetail': '检测到标准 API 额度：{0}。标准 API 按量付费。此操作将在{1}中更改 API 模式，并刷新可用模型。GLM-5.3 等仅编程计划可用的模型可能会消失；如有需要，请选择支持标准 API 的模型。余额不代表一定有权限访问所有模型。',
	'usage.recovery.switch': '切换到标准 API',
	'usage.recovery.scope.workspace': '当前工作区',
	'usage.recovery.scope.user': '用户设置',
	'usage.recovery.openSettings': '打开设置',
	'usage.recovery.getStandardKey': '获取标准 API 密钥',
	'usage.recovery.switchFailed': 'GLM 无法更改 API 模式，未执行任何更改。',
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
