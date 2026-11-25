# TODO

## zmiany 1 (done)
- [x] lista wszystkich wyników pod podium na ekranie końcowym (w przewijanym widoku)
- [x] podgląd pytania i odliczanie do ujawnienia odpowiedzi przed każdą rundą (kazde pytanie ma się najpierw wyswietlić, a dopiero potem po 5 sekundach mają się pokazać odpowiedzi)
- [x] płynne animacje między rundami i ekranami
- [x] ekran gry po uruchomieniu wyświetlany w osobnym oknie, na ekranie prowadzącego panel z opcjami (przewiń dalej, przerwij grę itp.)

## zmiany 2
- [x] możliwość zmiany kolejności pytań w edytorze
- [x] trzy tryby: quiz (pytania punktowane) [Q], opinie (pytania niepunktowane, ankiety, komentarze, chmury słów itp.) [O], tryb mieszany [M]
- [x] formy pytań:
    - pytanie ABCD [Q, M]
    - slider (podaj wartość w przedziale) [Q, O, M]
    - chmura słów (wpisz hasło) [O, M]
    - ankieta (takie samo jak pytania, ale pod koniec się pokazuje wykres kołowy z odpowiedziami) [O, M]
    - prawda/fałsz [Q, M]
- [x] możliwość dodawania zdjęć do pytań i odpowiedzi

## zmiany 3
- [x] konfiguracja Github Action do automatycznego testowania, budowania i wdrażania aplikacji na serwerze 2115.2115.xyz:
    - po merge'u na main ma być uruchamiany skrypt, który testuje aplikację i buduje nową paczkę
    - jeśli testy przejdą pomyślnie, to skrypt ma się logować na serwer przez ssh (private key) i wdrażać nową paczkę (katalog ~/containers/cyber-quiz ze sklonowanym repo)
    - po wdrożeniu restart kontenera cyber-quiz i swag

## zmiany 4
- [x] okno ustawień użytkownika jako Sheet (wysuwany z prawej strony) (jest opisany w dokumentacji neobrutalism.dev)
- [x] powiadomienia różne (np. nieudany/udany upload zdjęć, zapisanie quizu i inne) jako Toast (wylatujące powiadomienie w prawym dolnym rogu) (jest opisany w dokumentacji neobrutalism.dev)

## zmiany 5
- [x] przełącznik w panelu sterowania rozrywką do włączania i wyłączania automatycznego przełączania pytań (po wyłączeniu automatycznego przełączania pokazują się przyciski do ich przełączania ręcznego)
- [x] możliwość dołączenia do gry w trakcie jej trwania (aplikacja ma nie zwracać użytkownikowi błędu o tym, że gra już trwa)