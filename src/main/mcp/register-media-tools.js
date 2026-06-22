const path = require('path');
const { resolvePathTokens, tokenizePath } = require('../path-tokens');

function getPathTokenOptions(server) {
  const baseContext = server.getCurrentAgentContext?.()
    || server.getCurrentExecutionContext?.()
    || {};
  const sessionId = baseContext.sessionId ?? server.getCurrentSessionId?.() ?? null;
  const context = sessionId ? { ...baseContext, sessionId } : baseContext;
  return {
    agentManager: server._agentManager || null,
    sessionWorkspace: server._sessionWorkspace || null,
    executionDirectory: server._executionDirectory || null,
    sessionId,
    context
  };
}

async function resolveToolPath(server, rawPath) {
  const resolvedPath = await resolvePathTokens(rawPath, getPathTokenOptions(server));
  if (/\{[a-z_]+\}/i.test(resolvedPath)) {
    throw new Error(`Unresolved path token in path: ${rawPath}`);
  }
  return resolvedPath;
}

async function toPortablePath(server, absolutePath) {
  return tokenizePath(absolutePath, getPathTokenOptions(server));
}

async function getAllowedWorkspaceRoot(server) {
  if (!server._sessionWorkspace?.getWorkspacePath) {
    return null;
  }
  const sessionId = server.getCurrentSessionId?.() || 'default';
  return server._sessionWorkspace.getWorkspacePath(sessionId);
}

function getAllowedAgentinRoot(server) {
  if (server._agentManager?.basePath) {
    return path.dirname(server._agentManager.basePath);
  }
  if (server._sessionWorkspace?.basePath) {
    return path.dirname(server._sessionWorkspace.basePath);
  }
  return null;
}

async function assertMediaPathAllowed(server, filePath) {
  await server.assertExecutionPathAllowed?.(filePath, {
    extraRoots: [
      await getAllowedWorkspaceRoot(server),
      getAllowedAgentinRoot(server)
    ].filter(Boolean)
  });
}

function registerMediaTools(server) {
  server.registerTool('get_image_info', {
    name: 'get_image_info',
    description: 'Get information about an image file',
    userDescription: 'Returns dimensions and metadata of an image file',
    example: 'TOOL:get_image_info{"path":"C:/Users/photo.jpg"}',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the image file' }
      },
      required: ['path']
    }
  }, async (params) => {
    const fs = require('fs').promises;
    const filePath = await resolveToolPath(server, params.path);
    await assertMediaPathAllowed(server, filePath);
    const stat = await fs.stat(filePath);
    return { path: await toPortablePath(server, filePath), size: stat.size, modified: stat.mtime };
  });

  server.registerTool('open_media', {
    name: 'open_media',
    description: 'Open any media file with the default OS application',
    userDescription: 'Opens a media file (image, video, audio, document) using the default system application',
    example: 'TOOL:open_media{"path":"C:/Users/Music/song.mp3"}',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Full path to the media file to open' }
      },
      required: ['path']
    }
  }, async (params) => {
    const { shell } = require('electron');
    const fs = require('fs');
    const filePath = await resolveToolPath(server, params.path);
    await assertMediaPathAllowed(server, filePath);

    if (!fs.existsSync(filePath)) {
      return { success: false, error: `File not found: ${params.path}` };
    }

    const result = await shell.openPath(filePath);
    if (result) {
      return { success: false, error: result };
    }

    const ext = path.extname(filePath).toLowerCase();
    const mediaType = {
      '.mp3': 'audio', '.wav': 'audio', '.ogg': 'audio', '.flac': 'audio', '.m4a': 'audio',
      '.mp4': 'video', '.avi': 'video', '.mkv': 'video', '.mov': 'video', '.webm': 'video',
      '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.gif': 'image', '.bmp': 'image', '.webp': 'image',
      '.pdf': 'document', '.doc': 'document', '.docx': 'document', '.txt': 'document'
    }[ext] || 'file';

    return { success: true, opened: await toPortablePath(server, filePath), type: mediaType };
  });

  server.registerTool('play_audio', {
    name: 'play_audio',
    description: 'Play an audio file with the default music player',
    userDescription: 'Opens and plays an audio file (MP3, WAV, etc.) using the system music player',
    example: 'TOOL:play_audio{"path":"C:/Users/Music/song.mp3"}',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Full path to the audio file' }
      },
      required: ['path']
    }
  }, async (params) => {
    const { shell } = require('electron');
    const fs = require('fs');
    const filePath = await resolveToolPath(server, params.path);
    await assertMediaPathAllowed(server, filePath);

    if (!fs.existsSync(filePath)) {
      return { success: false, error: `Audio file not found: ${params.path}` };
    }

    const result = await shell.openPath(filePath);
    return result
      ? { success: false, error: result }
      : { success: true, playing: await toPortablePath(server, filePath) };
  });

  server.registerTool('view_image', {
    name: 'view_image',
    description: 'Open an image file with the default image viewer',
    userDescription: 'Opens an image file using the system image viewer',
    example: 'TOOL:view_image{"path":"C:/Users/Pictures/photo.jpg"}',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Full path to the image file' }
      },
      required: ['path']
    }
  }, async (params) => {
    const { shell } = require('electron');
    const fs = require('fs');
    const filePath = await resolveToolPath(server, params.path);
    await assertMediaPathAllowed(server, filePath);

    if (!fs.existsSync(filePath)) {
      return { success: false, error: `Image file not found: ${params.path}` };
    }

    const result = await shell.openPath(filePath);
    return result
      ? { success: false, error: result }
      : { success: true, viewing: await toPortablePath(server, filePath) };
  });

  server.registerTool('screenshot', {
    name: 'screenshot',
    description: 'Take a screenshot',
    userDescription: 'Captures a screenshot and saves it to the specified path',
    example: 'TOOL:screenshot{"savePath":"C:/Users/screenshot.png"}',
    inputSchema: {
      type: 'object',
      properties: {
        savePath: { type: 'string', description: 'Path to save the screenshot' }
      },
      required: ['savePath']
    }
  }, async (params) => {
    const { desktopCapturer } = require('electron');
    const fs = require('fs');
    const savePath = await resolveToolPath(server, params.savePath);
    await assertMediaPathAllowed(server, savePath);
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } });
    if (sources.length > 0) {
      const image = sources[0].thumbnail.toPNG();
      fs.writeFileSync(savePath, image);
      if (server._artifactRegistry) {
        const sessionId = server.getCurrentSessionId?.() || 'default';
        server._artifactRegistry.registerFile(sessionId, {
          name: path.basename(savePath),
          path: savePath,
          source: 'screenshot',
          category: 'media'
        });
      }
      return { success: true, savedTo: await toPortablePath(server, savePath) };
    }
    return { success: false, error: 'No screen found' };
  });
}

module.exports = { registerMediaTools };
