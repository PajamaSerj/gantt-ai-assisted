@{
    # Copy this file to config.psd1 and replace every placeholder.
    # Keep credentials out of this non-secret configuration file.
    FolderId = '<folder-id>'

    RegistryName = 'ai-gantt-planner'
    RepositoryName = 'ai-gantt-planner'
    ContainerName = 'ai-gantt-planner'
    ServiceAccountName = 'gantt-ai'

    LockboxSecretName = 'ai-gantt-planner-qwen'
    LockboxSecretKey = 'api-key'

    Cores = 1
    Memory = '512MB'
    ExecutionTimeout = '60s'
    Concurrency = 1

    AiModel = 'gpt://<folder-id>/qwen3.6-35b-a3b'
    AiBaseUrl = 'https://ai.api.cloud.yandex.net/v1'
    Public = $true
}
