# Garage Audio — ferramenta local para FiveM

Aplicação em PHP para analisar um resource, editar `audioNameHash` nos arquivos `vehicles.meta` e baixar uma cópia ZIP com os arquivos originais preservados e um relatório `audio-audit.csv`.

## Iniciar com XAMPP

1. Você pode copiar esta pasta para `C:\xampp\htdocs\UnySound` (ou ajustar o DocumentRoot do Apache).
2. No XAMPP Control Panel, inicie o Apache.
3. Abra `http://localhost/UnySound/`.
4. Envie um ZIP do resource ou selecione sua pasta pelo botão **Selecionar pasta**.
5. Escolha os hashes por veículo, aplique em lote quando for útil e baixe o ZIP corrigido.

PHP 8.1 ou superior é recomendado. O ZIP depende da extensão `ZipArchive` ativa. No XAMPP, confira `php.ini` e habilite `extension=zip` (remova o `;` inicial, se houver), depois reinicie o Apache. Para resources grandes, ajuste `upload_max_filesize=300M`, `post_max_size=320M`, `max_file_uploads=1000` e `max_input_time=300` no mesmo arquivo; o limite adicional da aplicação é 300 MB e 5.000 arquivos.

Como esta pasta já está em `C:\xampp\UnySound`, também é possível iniciar o servidor PHP embutido em PowerShell:

```powershell
C:\xampp\php\php.exe -d upload_max_filesize=300M -d post_max_size=320M -d max_file_uploads=1000 -d max_input_time=300 -S 127.0.0.1:8080 -t C:\xampp\UnySound
```

Abra `http://127.0.0.1:8080/`. Para a extensão ZIP, verifique que `extension=zip` está ativa no `C:\xampp\php\php.ini`.

## Como a validação funciona

A ferramenta verifica a sintaxe do hash (letras, números e `_`), informa campos vazios e registra os valores aplicados. Ela não consegue confirmar se um hash está instalado ou se o áudio toca no servidor: sons customizados dependem do resource de áudio e de sua configuração no FiveM. Depois de importar o pacote, teste o veículo no jogo. Use o nome de áudio fornecido pelo pack que contém o som.

A biblioteca embutida é uma lista inicial de nomes comuns e associações úteis, não um catálogo completo dos áudios disponíveis nas diferentes versões do GTA V nem dos packs da comunidade. Adicione outros nomes no campo **Digitar nome…**; os nomes presentes nos `vehicles.meta` importados também podem ser identificados manualmente.

## Arquivos e privacidade

O resource enviado fica temporariamente em `storage/<sessão>`, protegido contra acesso HTTP direto pelo `.htaccess`. O botão **Limpar projeto** remove os arquivos da sessão atual. A cópia de trabalho é usada para montar o ZIP e não altera os arquivos que estavam no computador antes do envio.

