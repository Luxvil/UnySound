<?php
declare(strict_types=1);
$model = strtolower((string)($_GET['model'] ?? ''));
if (!preg_match('/^[a-z0-9_]{1,64}$/', $model)) { http_response_code(400); exit('Invalid model'); }
$url = 'https://gta.mics.dev/glb/veh/' . rawurlencode($model) . '.glb';
$curl = curl_init($url);
curl_setopt_array($curl, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => false, CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_TIMEOUT => 45, CURLOPT_USERAGENT => 'GarageAudio/1.0']);
$body = curl_exec($curl);
$status = (int)curl_getinfo($curl, CURLINFO_HTTP_CODE);
$type = (string)curl_getinfo($curl, CURLINFO_CONTENT_TYPE);
$error = curl_error($curl);
curl_close($curl);
if (!is_string($body) || $status !== 200 || !str_contains(strtolower($type), 'model/gltf-binary')) { http_response_code($status >= 400 ? $status : 502); exit($error !== '' ? 'Model source unavailable' : '3D model unavailable'); }
header('Content-Type: model/gltf-binary');
header('Content-Length: ' . strlen($body));
header('Cache-Control: private, max-age=3600');
echo $body;
