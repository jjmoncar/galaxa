<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

$file = __DIR__ . '/scores.json';

function getScores($file) {
    if (!file_exists($file)) {
        return [];
    }
    $content = @file_get_contents($file);
    if (!$content) {
        return [];
    }
    $data = json_decode($content, true);
    return is_array($data) ? $data : [];
}

function saveScoresFile($file, $scores) {
    @file_put_contents($file, json_encode($scores, JSON_PRETTY_PRINT), LOCK_EX);
}

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'POST') {
    $rawInput = file_get_contents('php://input');
    $input = json_decode($rawInput, true);

    if (!$input) {
        $input = $_POST;
    }

    $name = isset($input['name']) ? strtoupper(substr(trim(strip_tags($input['name'])), 0, 3)) : '';
    $score = isset($input['score']) ? intval($input['score']) : 0;

    if (!empty($name) && $score > 0) {
        $scores = getScores($file);
        $scores[] = [
            'name' => $name,
            'score' => $score,
            'createdAt' => date('c')
        ];

        // Sort descending by score
        usort($scores, function($a, $b) {
            return $b['score'] - $a['score'];
        });

        // Keep top 50 scores in JSON file
        $scores = array_slice($scores, 0, 50);

        saveScoresFile($file, $scores);

        echo json_encode([
            'success' => true,
            'scores' => array_slice($scores, 0, 10)
        ]);
        exit;
    } else {
        http_response_code(400);
        echo json_encode([
            'success' => false,
            'error' => 'Invalid name or score'
        ]);
        exit;
    }
} else {
    // GET request
    $scores = getScores($file);
    usort($scores, function($a, $b) {
        return $b['score'] - $a['score'];
    });
    $top10 = array_slice($scores, 0, 10);
    echo json_encode($top10);
    exit;
}
