<?php
declare(strict_types=1);

function h(string $value): string {
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function json_response(array $data, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function safe_path(string $path): ?string {
    $path = str_replace('\\', '/', $path);
    if ($path === '' || str_starts_with($path, '/') || preg_match('/^[A-Za-z]:/', $path)) return null;
    foreach (explode('/', $path) as $part) {
        if ($part === '' || $part === '.' || $part === '..') return null;
    }
    return $path;
}

function project_dir(): ?string {
    $id = $_SESSION['project_id'] ?? '';
    return is_string($id) && preg_match('/^[a-f0-9]{32}$/', $id) ? APP_DIR . DIRECTORY_SEPARATOR . $id : null;
}

function remove_tree(string $path): void {
    if (!is_dir($path)) return;
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($it as $entry) {
        if ($entry->isDir()) rmdir($entry->getPathname());
        else unlink($entry->getPathname());
    }
    rmdir($path);
}

function start_project(): string {
    if ($old = project_dir()) remove_tree($old);
    $id = bin2hex(random_bytes(16));
    $root = APP_DIR . DIRECTORY_SEPARATOR . $id;
    if (!mkdir($root, 0775, true)) throw new RuntimeException('Não foi possível criar a área temporária.');
    $_SESSION['project_id'] = $id;
    $_SESSION['items'] = [];
    $_SESSION['mappings'] = [];
    $_SESSION['single_meta'] = false;
    $_SESSION['folder_files'] = 0;
    $_SESSION['folder_bytes'] = 0;
    return $root;
}

function uploaded_files(): array {
    $result = [];
    foreach ($_FILES as $field) {
        $names = (array)$field['name'];
        foreach ($names as $i => $name) {
            $result[] = [
                'name' => (string)$name,
                'tmp' => (string)(is_array($field['tmp_name']) ? $field['tmp_name'][$i] : $field['tmp_name']),
                'size' => (int)(is_array($field['size']) ? $field['size'][$i] : $field['size']),
                'error' => (int)(is_array($field['error']) ? $field['error'][$i] : $field['error']),
            ];
        }
    }
    return $result;
}

function save_uploads(string $root): int {
    $files = uploaded_files();
    if (!$files) throw new RuntimeException('Nenhum arquivo foi recebido. Confira os limites de upload do PHP.');
    $count = (int)($_SESSION['folder_files'] ?? 0);
    $bytes = (int)($_SESSION['folder_bytes'] ?? 0);
    foreach ($files as $i => $file) {
        if ($file['error'] !== UPLOAD_ERR_OK) throw new RuntimeException('Falha no envio de um arquivo (código ' . $file['error'] . ').');
        if (++$count > MAX_FILES || ($bytes += $file['size']) > MAX_UPLOAD_BYTES) throw new RuntimeException('Limite de 5.000 arquivos ou 300 MB excedido.');
        $relative = safe_path((string)($_POST['relative_paths'][$i] ?? $file['name']));
        if ($relative === null) throw new RuntimeException('Um arquivo possui caminho inválido.');
        $target = $root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relative);
        if (!is_dir(dirname($target)) && !mkdir(dirname($target), 0775, true)) throw new RuntimeException('Não foi possível criar a pasta do arquivo.');
        if (!move_uploaded_file($file['tmp'], $target)) throw new RuntimeException('Não foi possível salvar um arquivo.');
    }
    $_SESSION['folder_files'] = $count;
    $_SESSION['folder_bytes'] = $bytes;
    return count($files);
}

function discover_meta(string $root): array {
    $items = [];
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $file) {
        if (!$file->isFile() || strtolower($file->getFilename()) !== 'vehicles.meta') continue;
        $relative = str_replace('\\', '/', substr($file->getPathname(), strlen($root) + 1));
        $content = file_get_contents($file->getPathname());
        if ($content === false) continue;
        preg_match_all('/<Item\b[^>]*>.*?<\/Item>/is', $content, $matches);
        foreach ($matches[0] as $index => $block) {
            if (!preg_match('/<modelName\b[^>]*>(.*?)<\/modelName>/is', $block, $model)) continue;
            $name = trim(html_entity_decode(strip_tags($model[1]), ENT_QUOTES | ENT_XML1, 'UTF-8'));
            if ($name === '') continue;
            preg_match('/<audioNameHash\b[^>]*>(.*?)<\/audioNameHash>/is', $block, $audio);
            $value = isset($audio[1]) ? trim(html_entity_decode(strip_tags($audio[1]), ENT_QUOTES | ENT_XML1, 'UTF-8')) : '';
            $items[] = ['key' => $relative . '::' . $index, 'path' => $relative, 'index' => $index, 'model' => $name, 'audio' => $value, 'missing' => $value === ''];
        }
    }
    return $items;
}

function scan_vehicle_root(string $root): array {
    $resolved = realpath($root);
    if ($resolved === false || !is_dir($resolved)) throw new RuntimeException('A pasta indicada não existe ou não está acessível.');
    $items = [];
    foreach (new DirectoryIterator($resolved) as $vehicleDir) {
        if ($vehicleDir->isDot() || !$vehicleDir->isDir()) continue;
        foreach (new DirectoryIterator($vehicleDir->getPathname()) as $dataDir) {
            if ($dataDir->isDot() || !$dataDir->isDir() || strcasecmp($dataDir->getFilename(), 'data') !== 0) continue;
            foreach (new DirectoryIterator($dataDir->getPathname()) as $metaFile) {
                if ($metaFile->isDot() || !$metaFile->isFile() || strcasecmp($metaFile->getFilename(), 'vehicles.meta') !== 0) continue;
                $relative = $vehicleDir->getFilename() . '/data/' . $metaFile->getFilename();
                $content = file_get_contents($metaFile->getPathname());
                if ($content === false) continue;
                preg_match_all('/<Item\b[^>]*>.*?<\/Item>/is', $content, $matches);
                foreach ($matches[0] as $index => $block) {
                    if (!preg_match('/<modelName\b[^>]*>(.*?)<\/modelName>/is', $block, $model)) continue;
                    $name = trim(html_entity_decode(strip_tags($model[1]), ENT_QUOTES | ENT_XML1, 'UTF-8'));
                    if ($name === '') continue;
                    preg_match('/<audioNameHash\b[^>]*>(.*?)<\/audioNameHash>/is', $block, $audio);
                    $value = isset($audio[1]) ? trim(html_entity_decode(strip_tags($audio[1]), ENT_QUOTES | ENT_XML1, 'UTF-8')) : '';
                    $items[] = ['key' => $relative . '::' . $index, 'path' => $relative, 'index' => $index, 'model' => $name, 'audio' => $value, 'missing' => $value === ''];
                }
            }
        }
    }
    if (!$items) throw new RuntimeException('Nenhuma pasta de veículo com data/vehicles.meta e modelName foi encontrada.');
    $_SESSION['vehicle_root'] = $resolved;
    $_SESSION['items'] = $items;
    $_SESSION['mappings'] = [];
    $_SESSION['direct_root'] = true;
    return ['ok' => true, 'items' => $items, 'root' => $resolved];
}

function save_mappings_in_place(array $updates): array {
    $root = (string)($_SESSION['vehicle_root'] ?? '');
    if (empty($_SESSION['direct_root']) || !$root || !is_dir($root)) throw new RuntimeException('Analise primeiro a pasta raiz dos veículos.');
    $items = $_SESSION['items'] ?? [];
    $known = array_column($items, 'key');
    if (!$updates || array_diff(array_keys($updates), $known)) throw new RuntimeException('Seleção de veículos inválida.');
    foreach ($updates as $key => $audio) if (!preg_match('/^[A-Z0-9_]{1,64}$/', (string)$audio)) throw new RuntimeException('Nome de áudio inválido. Use letras, números e _.');
    $grouped = [];
    foreach ($updates as $key => $audio) {
        $split = strrpos((string)$key, '::');
        $relative = substr((string)$key, 0, $split);
        $grouped[$relative][$key] = strtoupper((string)$audio);
    }
    $changed = 0;
    foreach ($grouped as $relative => $mappings) {
        $parts = explode('/', $relative);
        if (count($parts) !== 3 || strcasecmp($parts[1], 'data') !== 0 || strcasecmp($parts[2], 'vehicles.meta') !== 0) throw new RuntimeException('Caminho de vehicles.meta inválido.');
        $file = $root . DIRECTORY_SEPARATOR . $parts[0] . DIRECTORY_SEPARATOR . $parts[1] . DIRECTORY_SEPARATOR . $parts[2];
        $real = realpath($file);
        if ($real === false || !str_starts_with(strtolower($real), strtolower($root . DIRECTORY_SEPARATOR)) || !is_file($real)) throw new RuntimeException('O arquivo de origem não foi encontrado: ' . $relative);
        $original = file_get_contents($real);
        if ($original === false) throw new RuntimeException('Não foi possível ler ' . $relative);
        $report = [];
        $updated = patch_meta($original, $mappings, $relative, $report);
        if (file_put_contents($real, $updated, LOCK_EX) === false) throw new RuntimeException('Não foi possível salvar na pasta de origem. Feche o arquivo no editor e tente novamente: ' . $relative);
        $changed += count($report);
    }
    foreach ($items as &$item) if (isset($updates[$item['key']])) { $item['audio'] = strtoupper((string)$updates[$item['key']]); $item['missing'] = false; }
    unset($item);
    $_SESSION['items'] = $items;
    return ['ok' => true, 'updated' => $changed, 'items' => $items];
}

function finish_project(string $root): array {
    $items = discover_meta($root);
    if (!$items) throw new RuntimeException('Nenhum vehicles.meta com modelName foi encontrado.');
    $_SESSION['items'] = $items;
    return ['ok' => true, 'items' => $items];
}

function upload_zip(): array {
    $files = uploaded_files();
    if (count($files) !== 1 || $files[0]['error'] !== UPLOAD_ERR_OK) throw new RuntimeException('Envie um arquivo ZIP válido.');
    if ($files[0]['size'] > MAX_UPLOAD_BYTES) throw new RuntimeException('O ZIP excede 300 MB.');
    $zip = new ZipArchive();
    if ($zip->open($files[0]['tmp']) !== true) throw new RuntimeException('Não foi possível abrir o ZIP.');
    $root = start_project();
    $bytes = 0;
    try {
        if ($zip->numFiles > MAX_FILES) throw new RuntimeException('O ZIP excede 5.000 arquivos.');
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $stat = $zip->statIndex($i);
            $entryName = (string)$stat['name'];
            if (str_ends_with($entryName, '/')) continue;
            $relative = safe_path($entryName);
            if ($relative === null) throw new RuntimeException('O ZIP contém um caminho inválido.');
            $bytes += (int)$stat['size'];
            if ($bytes > MAX_UPLOAD_BYTES) throw new RuntimeException('O conteúdo descompactado excede 300 MB.');
            $target = $root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relative);
            if (!is_dir(dirname($target)) && !mkdir(dirname($target), 0775, true)) throw new RuntimeException('Não foi possível criar uma pasta do ZIP.');
            $stream = $zip->getStream((string)$stat['name']);
            if ($stream === false) throw new RuntimeException('Não foi possível ler um arquivo do ZIP.');
            $out = fopen($target, 'wb');
            if ($out === false) { fclose($stream); throw new RuntimeException('Não foi possível gravar um arquivo do ZIP.'); }
            stream_copy_to_stream($stream, $out);
            fclose($out); fclose($stream);
        }
        return finish_project($root);
    } finally { $zip->close(); }
}

function patch_meta(string $content, array $mappings, string $relative, array &$report): string {
    $index = 0;
    return preg_replace_callback('/<Item\b[^>]*>.*?<\/Item>/is', static function (array $match) use (&$index, $mappings, $relative, &$report): string {
        $block = $match[0];
        $key = $relative . '::' . $index++;
        if (!array_key_exists($key, $mappings)) return $block;
        $audio = strtoupper(trim((string)$mappings[$key]));
        if ($audio === '') return $block;
        if (!preg_match('/^[A-Z0-9_]{1,64}$/', $audio)) throw new RuntimeException('Nome de áudio inválido: ' . $audio);
        preg_match('/<modelName\b[^>]*>(.*?)<\/modelName>/is', $block, $model);
        $name = isset($model[1]) ? trim(strip_tags($model[1])) : '';
        if (preg_match('/<audioNameHash\b[^>]*>.*?<\/audioNameHash>/is', $block)) {
            $block = preg_replace_callback('/(<audioNameHash\b[^>]*>).*?(<\/audioNameHash>)/is', static fn($m) => $m[1] . $audio . $m[2], $block, 1);
        } elseif (preg_match('/<audioNameHash\b[^>]*\/>/is', $block)) {
            $block = preg_replace('/<audioNameHash\b[^>]*\/>/is', '<audioNameHash>' . $audio . '</audioNameHash>', $block, 1);
        } else {
            $block = preg_replace_callback('/(<modelName\b[^>]*>.*?<\/modelName>)/is', static fn($m) => $m[1] . "\n      <audioNameHash>" . $audio . '</audioNameHash>', $block, 1);
        }
        $report[] = [$name, $relative, $audio, 'aplicado'];
        return $block;
    }, $content);
}

function export_project(): never {
    $root = project_dir();
    if (!$root || !is_dir($root)) throw new RuntimeException('Importe um resource antes de exportar.');
    $mappings = (array)($_SESSION['mappings'] ?? []);
    if (!empty($_SESSION['single_meta'])) {
        $report = [];
        $content = patch_meta((string)file_get_contents($root . '/vehicles.meta'), $mappings, 'vehicles.meta', $report);
        header('Content-Type: application/octet-stream');
        header('Content-Disposition: attachment; filename="vehicles.meta"');
        echo $content;
        exit;
    }
    $zip = new ZipArchive();
    $temp = tempnam(sys_get_temp_dir(), 'garage_audio_');
    if ($temp === false || $zip->open($temp, ZipArchive::OVERWRITE) !== true) throw new RuntimeException('Não foi possível criar o ZIP.');
    $report = [];
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $file) {
        if (!$file->isFile()) continue;
        $relative = str_replace('\\', '/', substr($file->getPathname(), strlen($root) + 1));
        $content = file_get_contents($file->getPathname());
        if ($content === false) throw new RuntimeException('Não foi possível ler um arquivo do projeto.');
        if (strtolower($file->getFilename()) === 'vehicles.meta') $content = patch_meta($content, $mappings, $relative, $report);
        $zip->addFromString($relative, $content);
    }
    $csv = "veiculo;arquivo;audioNameHash;resultado\n";
    foreach ($report as $row) $csv .= implode(';', array_map(static fn($v) => '"' . str_replace('"', '""', $v) . '"', $row)) . "\n";
    $zip->addFromString('audio-audit.csv', $csv);
    $zip->close();
    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="vehicles-meta-corrigido.zip"');
    header('Content-Length: ' . filesize($temp));
    readfile($temp);
    unlink($temp);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action'])) {
    try {
        switch ($_POST['action']) {
            case 'scan_root': json_response(scan_vehicle_root((string)($_POST['root'] ?? '')));
            case 'save_in_place':
                $updates = json_decode((string)($_POST['updates'] ?? '{}'), true, 512, JSON_THROW_ON_ERROR);
                if (!is_array($updates)) throw new RuntimeException('Dados de áudio inválidos.');
                json_response(save_mappings_in_place($updates));
            case 'upload':
                $incoming = uploaded_files();
                if (count($incoming) === 1 && strtolower($incoming[0]['name']) === 'vehicles.meta') {
                    $root = start_project();
                    $_POST['relative_paths'] = ['vehicles.meta'];
                    save_uploads($root);
                    $_SESSION['single_meta'] = true;
                    json_response(finish_project($root));
                }
                json_response(upload_zip());
            case 'insert_audio':
                $audio = strtoupper(trim((string)($_POST['audio'] ?? '')));
                if (!preg_match('/^[A-Z0-9_]{1,64}$/', $audio)) throw new RuntimeException('Informe um nome de áudio válido: letras, números e _.');
                $keys = json_decode((string)($_POST['keys'] ?? '[]'), true, 512, JSON_THROW_ON_ERROR);
                $available = array_column($_SESSION['items'] ?? [], 'key');
                if (!is_array($keys) || !$keys || array_diff($keys, $available)) throw new RuntimeException('Selecione os veículos que receberão o áudio.');
                $_SESSION['mappings'] = array_fill_keys($keys, $audio);
                export_project();
            case 'folder_start': start_project(); json_response(['ok' => true]);
            case 'folder_batch':
                $root = project_dir();
                if (!$root || !is_dir($root)) throw new RuntimeException('A sessão de envio expirou.');
                json_response(['ok' => true, 'files' => save_uploads($root)]);
            case 'folder_finish':
                $root = project_dir();
                if (!$root || !is_dir($root)) throw new RuntimeException('A sessão de envio expirou.');
                json_response(finish_project($root));
            case 'save':
                $values = json_decode((string)($_POST['mappings'] ?? '{}'), true, 512, JSON_THROW_ON_ERROR);
                if (!is_array($values)) throw new RuntimeException('Dados de mapeamento inválidos.');
                $_SESSION['mappings'] = $values;
                json_response(['ok' => true]);
            case 'export': export_project();
            case 'reset':
                if ($root = project_dir()) remove_tree($root);
                unset($_SESSION['project_id'], $_SESSION['items'], $_SESSION['mappings'], $_SESSION['folder_files'], $_SESSION['folder_bytes']);
                json_response(['ok' => true]);
            default: json_response(['error' => 'Ação desconhecida.'], 400);
        }
    } catch (Throwable $e) { json_response(['error' => $e->getMessage()], 400); }
}

$items = $_SESSION['items'] ?? [];
$mappings = $_SESSION['mappings'] ?? [];
$catalog = json_decode((string)file_get_contents(__DIR__ . '/assets/vehicles.json'), true, 512, JSON_THROW_ON_ERROR);
foreach ($catalog as &$entry) $entry['name'] = strtoupper($entry['models']);
unset($entry);
